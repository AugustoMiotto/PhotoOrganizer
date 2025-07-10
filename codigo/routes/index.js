// routes/index.js
const express = require('express');
const router = express.Router();
const passport = require('passport'); 
const db = require('../models');    
const multer = require('multer'); 
const { Op } = require('sequelize');
const fs = require('fs'); 
const path = require('path');
// --------- CONFIGURAÇÃO DO MULTER ---------

// Define onde os arquivos serão salvos e como serão nomeados
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Salva os arquivos na pasta 'public/uploads'
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    // Gera um nome de arquivo único para evitar colisões
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Extrai a extensão original do arquivo
    const fileExtension = file.originalname.split('.').pop();
    // Monta o novo nome do arquivo
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + fileExtension);
  }
});

// Filtro de arquivos: aceita apenas imagens
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true); // Aceita o arquivo
  } else {
    cb(new Error('Apenas arquivos de imagem são permitidos!'), false); // Rejeita o arquivo
  }
};

// Instância do Multer com as configurações
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // Limite de tamanho de arquivo (10MB)
});


// --------- Middleware para proteger rotas ---------

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { // método fornecido pelo Passport
    return next(); // Se o usuário está logado, continua para a próxima função da rota
  }
  // Se não estiver logado, redireciona para a página de login com uma mensagem de erro
  res.redirect('/login?error=Você precisa estar logado para acessar esta página.');
}


// --------- ROTAS GET ---------

// GET register page
router.get('/register', function(req, res, next) {
  res.render('register', { error: req.query.error, success: req.query.success });
});

// GET login page
router.get('/login', function(req, res, next) {
  res.render('login', { error: req.query.error, success: req.query.success });
});

// GET home page 
router.get('/', function(req, res, next) {
  if (req.isAuthenticated()) {

    // Se o usuário está logado, redireciona para o dashboard
    return res.redirect('/dashboard');
  }
  res.redirect('/login'); 
});

// GET dashboard 
router.get('/dashboard', isAuthenticated, async function(req, res, next) {
  try {
    const userId = req.user.id;
    const { tag, albumId, location, equipment, captureDate, search } = req.query; // Pega os parâmetros de consulta

    // Condições de filtro para a busca de fotos
    let photoWhereClause = { userId: userId };
    let includeTags = [];
    let includeAlbums = [];

    // --- Aplicar filtros ---
    if (location) {
      photoWhereClause.location = location;
    }
    if (equipment) {
      photoWhereClause.equipment = equipment;
    }
    if (captureDate) {
      // Para filtrar por uma data específica, ou um período
      photoWhereClause.captureDate = captureDate;
    }
    if (search) {
      // Busca por título ou descrição (case-insensitive)
      photoWhereClause[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { filename: { [Op.like]: `%${search}%` } } // Também busca no nome do arquivo
      ];
    }
    // Filtro por Tag 
    if (tag) {
      includeTags.push({
        model: db.Tag,
        as: 'tags',
        where: { name: tag },
        through: { attributes: [] },
        required: true // Usa INNER JOIN para garantir que a foto TEM essa tag
      });
    } else {
      // Se não há filtro de tag, ainda inclua as tags para exibição
      includeTags.push({
        model: db.Tag,
        as: 'tags',
        through: { attributes: [] }
      });
    }
    // Filtro por Álbum (requer include na tabela de junção)
    if (albumId) {
      includeAlbums.push({
        model: db.Album,
        as: 'albums',
        where: { id: albumId, userId: userId }, // Garante que o álbum pertence ao usuário
        through: { attributes: [] },
        required: true // Usa INNER JOIN para garantir que a foto ESTÁ nesse álbum
      });
    } else {
      // Se não há filtro de álbum, ainda inclua os álbuns para exibição
      includeAlbums.push({
        model: db.Album,
        as: 'albums',
        through: { attributes: [] }
      });
    }
    // 1. Buscar todas as fotos do usuário com os filtros aplicados
    const photos = await db.Photo.findAll({
      where: photoWhereClause,
      include: [
        ...includeTags, // Espalha os includes de tags
        ...includeAlbums  // Espalha os includes de álbuns
      ],
      order: [['uploadDate', 'DESC']]
    });
    // 2. Buscar todos os álbuns do usuário (para preencher o filtro de álbum)
    const albumsForFilter = await db.Album.findAll({
      where: { userId: userId },
      order: [['name', 'ASC']]
    });
    // 3. Buscar todas as tags do usuário (para preencher o filtro de tags)
    const allUserTags = await db.Tag.findAll({
      include: [{
        model: db.Photo,
        as: 'photos',
        where: { userId: userId },
        attributes: [], 
        through: { attributes: [] },
        required: true // Garante que a tag está associada a pelo menos uma foto do usuário
      }],
      attributes: ['name'], // Pega apenas o nome da tag
      group: ['Tag.name'], // Garante tags únicas
      order: [['name', 'ASC']]
    });
    const uniqueTags = allUserTags.map(t => t.name);


    // 4. Extrair locais e equipamentos únicos de TODAS as fotos do usuário (para preencher os filtros)
    const allUserPhotosForFilters = await db.Photo.findAll({
        where: { userId: userId },
        attributes: ['location', 'equipment'],
        group: ['location', 'equipment'] // Agrupa para pegar valores únicos mais eficientemente
    });

    const uniqueLocations = [...new Set(allUserPhotosForFilters.map(p => p.location).filter(Boolean))].sort();
    const uniqueEquipments = [...new Set(allUserPhotosForFilters.map(p => p.equipment).filter(Boolean))].sort();


    // 5. Preparar os dados para o `photo-grid` (misturando fotos e álbuns)
    let photosAndAlbums = [];

    // Adiciona as fotos filtradas
    photos.forEach(photo => {
      photosAndAlbums.push({
        id: photo.id,
        type: 'photo',
        imageUrl: photo.filepath,
        title: photo.title || photo.filename,
        description: photo.description || 'Sem descrição',
        location: photo.location || 'Não informado',
        captureDate: photo.captureDate ? new Date(photo.captureDate).toLocaleDateString('pt-BR') : 'Não informada',
        equipment: photo.equipment || 'Não informado',
        tags: photo.tags.map(tag => tag.name),
      });
    });

    // Se não houver filtro de álbum, adicione os álbuns do usuário também
    if (!albumId && !tag && !location && !equipment && !captureDate && !search) {
        const allUserAlbums = await db.Album.findAll({
            where: { userId: userId },
            include: [{ model: db.Photo, as: 'photos', attributes: ['id'] }],
            order: [['name', 'ASC']]
        });
        allUserAlbums.forEach(album => {
            photosAndAlbums.push({
                id: album.id,
                type: 'album',
                imageUrl: 'https://placehold.co/300x200/A07A65/FFF?text=ALBUM', // Ou a capa do álbum
                title: album.name,
                description: album.description || 'Sem descrição',
                photoCount: album.photos.length,
            });
        });
    }

    // Ordenar photosAndAlbums (se misturar fotos e álbuns)
    photosAndAlbums.sort((a, b) => {
        // Exemplo: álbuns primeiro, depois fotos, ambos por título
        if (a.type === 'album' && b.type === 'photo') return -1;
        if (a.type === 'photo' && b.type === 'album') return 1;
        return a.title.localeCompare(b.title); // Ordena alfabeticamente
    });


    // Renderiza o dashboard com todos os dados e os valores dos filtros selecionados
    res.render('dashboard', {
      user: req.user,
      photosAndAlbums: photosAndAlbums,
      tags: uniqueTags,
      albums: albumsForFilter, // Passa os objetos de álbum completos para o filtro de álbum
      locations: uniqueLocations,
      equipments: uniqueEquipments,
      selectedTag: tag || '', // Passa o valor selecionado para o EJS
      selectedAlbumId: albumId || '',
      selectedLocation: location || '',
      selectedEquipment: equipment || '',
      selectedCaptureDate: captureDate || '',
      searchTerm: search || '',
      success: req.query.success,
      error: req.query.error
    });

  } catch (error) {
    console.error('Erro ao carregar dashboard com filtros:', error);
    res.redirect('/login?error=Não foi possível carregar o dashboard. Tente novamente.');
  }
});

// GET profile 
router.get('/profile', isAuthenticated, async function(req, res, next) {
  try {
    const user = req.user; // O usuário logado

    // --- CARREGAR DADOS ADICIONAIS ---
    const totalPhotos = await db.Photo.count({ where: { userId: user.id } });
    const totalAlbums = await db.Album.count({ where: { userId: user.id } });

    const storageUsedBytes = await db.Photo.sum('size', { where: { userId: user.id } }) || 0;
    const storageUsedMB = (storageUsedBytes / (1024 * 1024)).toFixed(2); // Convertendo para MB

    // objeto com todos os dados 
    const profileData = {
      
        name: user.username, 
        email: user.email,
        bio: user.bio || 'Adicione uma biografia!', 
        avatarUrl: user.avatarUrl || 'https://placehold.co/150x150/D4AF37/5A3D2B?text=Avatar', 
        totalPhotos: totalPhotos,
        totalAlbums: totalAlbums,
        storageUsed: storageUsedMB,
        subscriptionPlan: user.subscriptionPlan || 'Gratuito', 
        user: user.username,
    };

    // Renderiza o template 'profile' e passa o objeto 'profileData'
    res.render('profile', { user: profileData });

  } catch (error) {
    console.error('Erro ao carregar perfil do usuário:', error);
    // Redireciona com uma mensagem de erro em caso de falha
    res.redirect('/dashboard?error=Não foi possível carregar seu perfil. Tente novamente.');
  }
});

// --------- CONFIGURAÇÃO MULTER DO AVATAR ---------
const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/avatars/'); // Pode ser uma pasta específica para avatares
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = file.originalname.split('.').pop();
    cb(null, 'avatar-' + req.user.id + '-' + uniqueSuffix + '.' + fileExtension); // Nome único por usuário
  }
});
const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de imagem são permitidos para avatar!'), false);
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 } // Limite de 2MB para avatar
});


//GET edit-profile
router.get('/profile/edit', isAuthenticated, async function(req, res, next) {
  try {
    const user = req.user; // O usuário logado

    // Carrega todas as fotos do usuário para a opção "Usar Foto Existente"
    const userPhotos = await db.Photo.findAll({
      where: { userId: user.id },
      attributes: ['id', 'title', 'filename', 'filepath'], // Pega apenas os dados necessários
      order: [['uploadDate', 'DESC']]
    });

    res.render('edit-profile', {
        user: {
            username: user.username,
            email: user.email,
            bio: user.bio || '',
            avatarUrl: user.avatarUrl || ''
        },
        photos: userPhotos, // <--- PASSA AS FOTOS DO USUÁRIO
        error: req.query.error,
        success: req.query.success
    });
  } catch (error) {
    console.error('Erro ao carregar página de edição de perfil:', error);
    res.redirect('/profile?error=Não foi possível carregar a página de edição.');
  }
});

// GET Upload 
router.get('/upload', isAuthenticated, async function(req, res, next) {
  try {
    const userId = req.user.id;
    // Carrega os álbuns do usuário logado para preencher o <select>
    const userAlbums = await db.Album.findAll({
      where: { userId: userId },
      order: [['name', 'ASC']]
    });
    res.render('upload', { user: req.user, albums: userAlbums, error: req.query.error, success: req.query.success });
  } catch (error) {
    console.error('Erro ao carregar álbuns para página de upload:', error);
    res.redirect('/dashboard?error=Erro ao carregar página de upload.');
  }
});


// GET logout
router.get('/logout', function(req, res, next) {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/login?success=Você foi desconectado.');
  });
});

// GET about-us
router.get('/about-us',function(req,res,next){
  res.render('about-us')
})
// GET: Rota para exibir o formulário de criação de álbum
router.get('/create-album', isAuthenticated, (req, res) => {
    // Renderiza a view, passando possíveis mensagens de erro/sucesso do redirecionamento
    res.render('create-album', { 
        user: req.user,
        error: req.query.error,
        success: req.query.success 
    });
});

// GET foto detalhada
router.get('/photo/:id', async function(req, res, next) {
  try {
    const photoId = req.params.id;
    const photo = await db.Photo.findByPk(photoId, {
      include: [
        { model: db.User, as: 'user' },
        { model: db.Tag, as: 'tags' },
        { model: db.Category, as: 'categories' },
        { model: db.Album, as: 'albums' }
      ]
    });
    if (!photo) {
      return res.status(404).send('Foto não encontrada');
    }
    res.render('photo', { photo: photo });
  } catch (error) {
    console.error('Erro ao carregar detalhes da foto:', error);
    res.status(500).send('Erro ao carregar detalhes da foto');
  }
});

/*GET para editar foto FALTA ARRUMAR
router.get('/photo/:id/edit', ensureAuth, async (req, res, next) => {
  try {
    // Busca a foto apenas do usuário logado
    const photo = await Photo.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!photo) {
      return res.status(404).send('Foto não encontrada');
    }

    // Se quiser permitir re-alocar em outro álbum
    const albums = await Album.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']]
    });

    res.render('photo-edit', { photo, albums });
  } catch (err) {
    next(err);
  }
});

//Rota PUT FALTA ARRUMAR
router.put('/photo/:id', ensureAuth, async (req, res, next) => {
  try {
    const { title, description, location, captureDate, album, tags } = req.body;

    // Encontra a foto e garante que pertence ao usuário
    const photo = await Photo.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!photo) {
      return res.status(404).send('Foto não encontrada');
    }

    // Atualiza os campos
    await photo.update({
      title,
      description,
      location,
      captureDate: captureDate || null,
      albumId: album === 'Nenhum Álbum' ? null : album,
      tags: tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
    });

    res.redirect(`/photo/${photo.id}`);
  } catch (err) {
    next(err);
  }
});
*/
// --------- ROTAS POST ---------

// POST register page
router.post('/register', async function(req, res, next) {
  const { username, email, password } = req.body;

  try {
    // 1. Validação básica (campos vazios)
    if (!username || !email || !password) {
      return res.redirect('/register?error=Por favor, preencha todos os campos.');
    }

    // 2. Verificar se o e-mail já existe
    const existingEmail = await db.User.findOne({ where: { email: email } });
    if (existingEmail) {
      return res.redirect('/register?error=Este e-mail já está em uso.');
    }

    // 3. Verificar se o nome de usuário já existe
    const existingUsername = await db.User.findOne({ where: { username: username } });
    if (existingUsername) {
        return res.redirect('/register?error=Este nome de usuário já está em uso.');
    }

    // 4. Criar o novo usuário (a senha será hashed automaticamente pelo hook do modelo)
    const newUser = await db.User.create({
      username,
      email,
      password
    });

    // 5. Autenticar o usuário recém-criado e iniciar a sessão
    req.login(newUser, function(err) {
      if (err) {
        console.error('Erro ao fazer login após o registro:', err);
        return next(err);
      }
      // Redireciona para o dashboard após o registro E login bem-sucedido
      return res.redirect('/dashboard?success=Registro realizado com sucesso e login efetuado!');
    });

  } catch (error) {
    console.error('Erro no registro do usuário:', error);
    return res.redirect('/register?error=Ocorreu um erro ao registrar. Tente novamente.');
  }
});

//POST login
router.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard', // Redireciona para o dashboard em caso de sucesso
  failureRedirect: '/login?error=Email ou senha inválidos.',
  failureFlash: false
}));

//POST: /profile/edit 
// avatarUpload.single('new_avatar_file') para processar o upload do arquivo de avatar, se houver.
router.post('/profile/edit', isAuthenticated, avatarUpload.single('new_avatar_file'), async function(req, res, next) {
  try {
    console.log('[POST /profile/edit] -- INÍCIO DA ROTA --');
    console.log('[POST /profile/edit] Conteúdo COMPLETO do req.body:', JSON.stringify(req.body, null, 2)); // Log completo
    console.log('[POST /profile/edit] req.file (se houver):', req.file);

    const user = req.user;
    const { username, bio, avatar_source, existing_photo_id } = req.body;
    let newAvatarUrl = user.avatarUrl;

    console.log(`[POST /profile/edit] Valor de 'username' desestruturado: '${username}'`);
    console.log(`[POST /profile/edit] Tipo de 'username': ${typeof username}`);
    console.log(`[POST /profile/edit] 'username' é null/undefined? ${!username}`);
    console.log(`[POST /profile/edit] 'username' é string vazia ou só espaços? ${username && username.trim() === ''}`);

    if (!username || username.trim() === '') {
      console.log('[POST /profile/edit] === VALIDAÇÃO FALHOU: Nome de usuário vazio ou apenas espaços ===');
      return res.redirect('/profile/edit?error=O nome de usuário não pode estar vazio.');
    }
    console.log('[POST /profile/edit] Validação de username BEM SUCEDIDA.'); // Este log deve aparecer se passar
    // --------------------------------------------------------------------------

    // --- Armazenar a URL do avatar antigo antes da atualização ---
    const oldAvatarUrl = user.avatarUrl;
    const defaultPlaceholder = 'https://placehold.co/80x80/D4AF37/5A3D2B?text=Avatar';

    // --- Lógica para determinar a nova URL do avatar ---
    if (avatar_source === 'existing') {
        if (!existing_photo_id) {
            console.log('[POST /profile/edit] Avatar Source: Existing, mas nenhum ID de foto selecionado.');
            return res.redirect('/profile/edit?error=Selecione uma foto existente para o avatar.');
        }
        const selectedPhoto = await db.Photo.findOne({
            where: { id: existing_photo_id, userId: user.id },
            attributes: ['filepath']
        });
        if (selectedPhoto) {
            newAvatarUrl = selectedPhoto.filepath;
            console.log('[POST /profile/edit] Avatar atualizado para foto existente:', newAvatarUrl);
        } else {
            console.log('[POST /profile/edit] Avatar Source: Existing, foto inválida.');
            return res.redirect('/profile/edit?error=Foto existente selecionada inválida.');
        }
    } else if (avatar_source === 'upload') {
        if (!req.file) { // Se esta condição for verdadeira, o Multer não processou o arquivo
            console.log('[POST /profile/edit] Avatar Source: Upload, mas nenhum arquivo enviado (req.file vazio).');
            // Isso pode acontecer se o campo não era requerido e o usuário não selecionou.
            // Se o Multer for configurado para 'required', ele já teria gerado um erro antes.
            return res.redirect('/profile/edit?error=Nenhum arquivo de avatar foi enviado para upload.');
        }
        newAvatarUrl = '/uploads/avatars/' + req.file.filename;
        console.log('[POST /profile/edit] Avatar atualizado para novo upload:', newAvatarUrl);
    } else if (avatar_source === 'current') {
        console.log('[POST /profile/edit] Avatar Source: Current. Mantendo avatar atual.');
        // Nada a fazer, newAvatarUrl já tem o valor atual
    } else {
        // Cenário para onde nenhum radio foi selecionado, ou valor inválido
        console.log('[POST /profile/edit] Avatar Source: Não especificado ou inválido. Mantendo avatar atual.');
        newAvatarUrl = user.avatarUrl; // Garante que mantém o avatar atual se a opção for inválida
    }

    // --- Lógica para remover o avatar antigo do servidor ---
    if (oldAvatarUrl && oldAvatarUrl.startsWith('/uploads/avatars/') && oldAvatarUrl !== newAvatarUrl && oldAvatarUrl !== defaultPlaceholder) {
        const absolutePath = path.join(__dirname, '../public', oldAvatarUrl);
        
        fs.unlink(absolutePath, (err) => {
            if (err) {
                console.error(`[POST /profile/edit] Erro ao remover avatar antigo do servidor (${absolutePath}):`, err);
            } else {
                console.log(`[POST /profile/edit] Avatar antigo removido do servidor: ${absolutePath}`);
            }
        });
    }

    // --- Atualizar o usuário no banco de dados ---
    await user.update({
      username: username,
      bio: bio || null,
      avatarUrl: newAvatarUrl,
    });

    console.log('[POST /profile/edit] Perfil atualizado com sucesso para:', user.username);
    res.redirect('/profile?success=Perfil atualizado com sucesso!');

  } catch (error) {
    console.error('[POST /profile/edit] Erro ao atualizar perfil do usuário:', error);

    // --- TRATAMENTO MELHORADO DE ERROS DO MULTER ---
    let errorMessage = 'Ocorreu um erro ao atualizar o perfil. Tente novamente.';
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            errorMessage = 'O arquivo é muito grande. Tamanho máximo permitido: 2MB.';
        } else if (error.code === 'FILE_REQUIRED') { // Se o Multer tiver um erro para campo requerido
            errorMessage = 'Nenhum arquivo de avatar foi selecionado.';
        } else {
            errorMessage = error.message; // Outros erros do Multer
        }
    } else if (error.message === 'Apenas arquivos de imagem são permitidos para avatar!') {
        errorMessage = error.message; // Erro do seu fileFilter customizado
    }
    // -----------------------------------------------

    res.redirect(`/profile/edit?error=${encodeURIComponent(errorMessage)}`);
  }
});

// POST 'upload.single('photo')' espera um campo de formulário chamado 'photo'
router.post('/upload', isAuthenticated, upload.single('image'), async function(req, res, next) {
  try {
    if (!req.file) {
      return res.redirect('/upload?error=Nenhum arquivo de imagem foi enviado.');
    }

    // Pega os dados do formulário (incluindo os novos campos)
    const { title, description, location, equipment, capture_date, tags, album } = req.body;

    // 1. Criar o registro da foto no banco de dados
    const newPhoto = await db.Photo.create({
      userId: req.user.id,
      filename: req.file.originalname,
      storageFilename: req.file.filename,
      filepath: '/uploads/' + req.file.filename, // Caminho público para o front-end
      mimetype: req.file.mimetype,
      size: req.file.size,
      title: title || null,
      description: description || null,
      location: location || null,
      equipment: equipment || null,
      captureDate: capture_date || null, // Salva a data de captura
    });

    // 2. Lidar com as Tags
    if (tags) {
      const tagNames = tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '');
      for (const tagName of tagNames) {
        // Encontra ou cria a tag
        const [tag, created] = await db.Tag.findOrCreate({
          where: { name: tagName },
          defaults: { name: tagName }
        });
        // Associa a foto à tag
        await newPhoto.addTag(tag); // Método addTag é gerado pelo Sequelize automaticamente
      }
    }

    // 3. Lidar com o Álbum
    if (album) {
      // Verifica se o álbum selecionado existe e pertence ao usuário
      const existingAlbum = await db.Album.findOne({
        where: {
          id: album,
          userId: req.user.id // Garante que o álbum pertence ao usuário logado
        }
      });
      if (existingAlbum) {
        await newPhoto.addAlbum(existingAlbum); // Associa a foto ao álbum existente
      } else {
        // Caso o ID do álbum não seja válido ou não pertença ao usuário
        console.warn(`Álbum com ID ${album} não encontrado ou não pertence ao usuário ${req.user.id}. Foto não associada ao álbum.`);
        // Você pode adicionar uma mensagem de erro para o usuário aqui se quiser
      }
      
    }

    console.log('Foto e metadados salvos, tags e álbum associados com sucesso:', newPhoto.filepath);
    res.redirect('/dashboard?success=Foto enviada com sucesso!');

  } catch (error) {
    console.error('Erro no upload da foto:', error);

    // Se o erro for do Multer (ex: tipo de arquivo inválido, tamanho excedido)
    if (error instanceof multer.MulterError) {
        return res.redirect(`/upload?error=${error.message}`);
    } else if (error.message === 'Apenas arquivos de imagem são permitidos!') {
        return res.redirect(`/upload?error=${error.message}`);
    }

    res.redirect('/upload?error=Ocorreu um erro ao enviar a foto. Tente novamente.');
  }
});
// POST: Rota para processar a criação do álbum
router.post('/create-album', isAuthenticated, async (req, res) => {
    // Pega os dados do corpo do formulário. O nome do input no EJS será 'albumName'.
    const { albumName, description } = req.body;
    const userId = req.user.id; // ID do usuário logado

    try {
        // 1. Validação no Servidor
        if (!albumName || albumName.trim() === '') {
            // Redireciona de volta para o formulário com uma mensagem de erro
            return res.redirect('/create-album?error=O nome do álbum é obrigatório.');
        }

        // 2. Criação do Álbum no Banco de Dados usando Sequelize
        await db.Album.create({
            name: albumName.trim(),
            description: description ? description.trim() : null,
            userId: userId
        });
        
        // 3. Redirecionamento para o Dashboard com mensagem de sucesso
        res.redirect('/dashboard?success=Álbum criado com sucesso!');

    } catch (error) {
        // Tratamento de erros do banco de dados
        console.error('Erro ao criar o álbum:', error);
        res.redirect('/create-album?error=Ocorreu um erro inesperado. Tente novamente.');
    }
});
module.exports = router;