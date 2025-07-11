// routes/index.js
const express = require('express');
const router = express.Router();
const passport = require('passport'); 
const db = require('../models');    
const multer = require('multer'); 
const { Op } = require('sequelize');
const fs = require('fs'); 
const path = require('path');
const mailTransporter = require('../config/nodemailer'); // Importe o transporter do Nodemailer
const { v4: uuidv4 } = require('uuid');
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
  if (req.isAuthenticated()) { // 1. Verifica se o usuário está logado
    if (req.user.isVerified) { // 2. Se logado, verifica se o e-mail está verificado
      return next(); // Permite o acesso
    } else {
      return res.redirect('/login?error=' + encodeURIComponent('Sua conta precisa ser verificada por e-mail para acessar este recurso. Por favor, verifique sua caixa de entrada (e spam).'));
    }
  } else {
    // 4. Se não estiver logado, redireciona para o login com mensagem padrão
    res.redirect('/login?error=' + encodeURIComponent('Você precisa estar logado para acessar esta página.'));
  }
}

// --------- ROTAS GET ---------

// GET register page
router.get('/register', function(req, res, next) {
  res.render('register', {
    error: req.query.error,
    success: req.query.success,
    needsVerification: req.query.needsVerification === 'true', // Nova flag
    emailForVerification: req.query.email 
  });
});

// --- NOVA ROTA: GET para verificação de e-mail ---
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await db.User.findOne({ where: { verificationToken: token } });

    if (!user) {
      return res.redirect('/login?error=' + encodeURIComponent('Link de verificação inválido ou expirado.'));
    }
    if (user.isVerified) {
      return res.redirect('/login?success=' + encodeURIComponent('Seu e-mail já foi verificado! Por favor, faça login.'));
    }

    // Ativa a conta do usuário
    await user.update({ isVerified: true, verificationToken: null });

    res.redirect('/login?success=' + encodeURIComponent('Seu e-mail foi verificado com sucesso! Agora você pode fazer login.'));

  } catch (error) {
    console.error('Erro na verificação de e-mail:', error);
    res.redirect('/login?error=' + encodeURIComponent('Ocorreu um erro ao verificar seu e-mail. Tente novamente.'));
  }
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

// GET Solicitar redefinição de senha 
router.get('/forgot-password', function(req, res) {
  res.render('forgot-password', { error: req.query.error, success: req.query.success });
});

// GET Validar token e exibir formulário de nova senha 
router.get('/reset-password/:token', async function(req, res) {
  const { token } = req.params;

  try {
    const user = await db.User.findOne({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { [Op.gt]: new Date() } // Token não pode estar expirado
      }
    });

    if (!user) {
      // Token inválido ou expirado
      return res.render('reset-password', { tokenValid: false, error: 'O link de redefinição é inválido ou expirou.' });
    }

    // Token válido, renderiza o formulário para a nova senha
    res.render('reset-password', { tokenValid: true, token: token, error: null, success: null });

  } catch (error) {
    console.error('Erro ao validar token de redefinição de senha:', error);
    res.render('reset-password', { tokenValid: false, error: 'Ocorreu um erro ao validar o link de redefinição.' });
  }
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
    // req.user.id pode ser usado para garantir que o usuário só veja suas próprias fotos
    // const userId = req.user.id; // Descomente e adicione ao where se quiser proteger a rota
    
    const photo = await db.Photo.findByPk(photoId, {
      // where: { id: photoId, userId: userId }, // Adicione esta linha se descomentou o userId
      include: [
        { model: db.User, as: 'user', attributes: ['username'] }, // Pega apenas o username do user
        { model: db.Tag, as: 'tags', attributes: ['name'], through: { attributes: [] } },
        { model: db.Category, as: 'categories', attributes: ['name'], through: { attributes: [] } },
        { model: db.Album, as: 'albums', attributes: ['name'], through: { attributes: [] } }
      ]
    });

    if (!photo) {
      return res.status(404).send('Foto não encontrada');
    }

    // Se você não quer que o usuário veja fotos de outros usuários diretamente pela URL,
    // adicione uma verificação aqui, mesmo que não proteja com isAuthenticated.
    // if (photo.userId !== req.user.id) {
    //   return res.status(403).send('Você não tem permissão para visualizar esta foto.');
    // }

    res.render('photo', { photo: photo });
  } catch (error) {
    console.error('Erro ao carregar detalhes da foto:', error);
    // Para depuração, você pode enviar o erro para o cliente temporariamente
    // res.status(500).send(`Erro ao carregar detalhes da foto: ${error.message}`);
    res.status(500).send('Erro ao carregar detalhes da foto. Tente novamente.');
  }
});

// Rota para excluir a foto aberta
router.delete('/photo/:id', async function(req, res, next) {
  try {
    const photoId = req.params.id;
    const userId = req.user.id;

    const photo = await db.Photo.findByPk(photoId);

    if (!photo) {
      return res.status(404).send('Foto não encontrada.');
    }

    //somente o dono da foto pode excluí-la
    if (photo.userId !== userId) {
      return res.status(403).send('Você não tem permissão para excluir esta foto.');
    }

    //exclui o arquivo do servidor
    const caminho = path.join(process.cwd(),'public', 'uploads', photo.filepath);
    try {
      await fs.unlink(caminho);
    } catch (fileError) {
      console.error('Erro ao tentar excluir o arquivo da foto:', fileError);
    }

    await photo.destroy();
    //não apaga do upload por motivos de monitoramento secreto...
    res.redirect('/dashboard');

  } catch (error) {
    console.error('Erro ao excluir a foto:', error);
    res.status(500).send('Erro ao processar a exclusão da foto.');
  }
});

// Rota para MOSTRAR o formulário de edição de uma foto
router.get('/photo/:id/edit', async function(req, res, next) {
  try {
    const photoId = req.params.id;
    const userId = req.user.id;

    // Busca a foto incluindo as associações para preencher o formulário
    const photo = await db.Photo.findByPk(photoId, {
      include: [
        { model: db.Tag, as: 'tags', through: { attributes: [] } },
        { model: db.Category, as: 'categories', through: { attributes: [] } },
        { model: db.Album, as: 'albums', through: { attributes: [] } }
      ]
    });

    if (!photo) {
      return res.status(404).send('Foto não encontrada.');
    }

    // VERIFICAÇÃO DE SEGURANÇA: Garante que apenas o dono da foto pode editá-la
    if (photo.userId !== userId) {
      return res.status(403).send('Você não tem permissão para editar esta foto.');
    }
    
    // Você também pode querer buscar todas as tags/categorias/álbuns disponíveis
    // para que o usuário possa escolher no formulário. Ex:
    // const allTags = await db.Tag.findAll();
    // E passar para o res.render

    res.render('edit-photo', { photo }); // Renderiza uma nova view 'edit-photo.ejs'

  } catch (error) {
    console.error('Erro ao carregar formulário de edição:', error);
    res.status(500).send('Erro ao carregar a página de edição.');
  }
});

// Rota para ATUALIZAR uma foto após o envio do formulário de edição
router.put('/photo/:id', async function(req, res, next) {
  try {
    const photoId = req.params.id;
    const userId = req.user.id;
    
    const photo = await db.Photo.findByPk(photoId);

    if (!photo) {
      return res.status(404).send('Foto não encontrada.');
    }

    // VERIFICAÇÃO DE SEGURANÇA: Garante que apenas o dono da foto pode alterá-la
    if (photo.userId !== userId) {
      return res.status(403).send('Você não tem permissão para alterar esta foto.');
    }

    // Extrai os dados do corpo da requisição (do formulário)
    const { title, description, captureDate, location, equipment } = req.body;

    // Atualiza a foto no banco de dados com os novos dados
    await photo.update({
      title,
      description,
      captureDate: captureDate || null, // Garante que datas vazias virem null
      location,
      equipment
    });
    
    // Lógica para atualizar tags, categorias e álbuns seria mais complexa.
    // Exemplo para tags:
    // if (req.body.tags) {
    //   const tagNames = req.body.tags.split(',').map(t => t.trim());
    //   // ... lógica para encontrar ou criar tags e associá-las com photo.setTags()
    // }

    // Redireciona o usuário de volta para a página da foto para ver as alterações
    res.redirect(`/photo/${photoId}`);

  } catch (error) {
    console.error('Erro ao atualizar a foto:', error);
    res.status(500).send('Erro ao processar a atualização da foto.');
  }
});

// GET - PÁGINA PARA VISUALIZAR APENAS OS ÁLBUNS
router.get('/my-albums', isAuthenticated, async function(req, res, next) {
  try {
    const userId = req.user.id;

    // 1. Busca todos os álbuns do usuário
    const userAlbums = await db.Album.findAll({
      where: { userId: userId },
      // Inclui as fotos associadas para contagem e para a imagem de capa
      include: [{
        model: db.Photo,
        as: 'photos',
        attributes: ['filepath'], // Pega apenas o caminho da imagem, para otimizar
        through: { attributes: [] } // Não precisa dos dados da tabela de junção
      }],
      order: [['name', 'ASC']] // Ordena os álbuns por nome
    });

    // 2. Formata os dados para a view
    const formattedAlbums = userAlbums.map(album => {
      const photoCount = album.photos ? album.photos.length : 0;
      // Define uma imagem de capa. Se o álbum tiver fotos, usa a primeira. Senão, um placeholder.
      const coverImageUrl = photoCount > 0 ? album.photos[0].filepath : 'https://placehold.co/300x200/A07A65/FFF?text=Vazio';

      return {
        id: album.id,
        name: album.name,
        description: album.description || 'Sem descrição',
        photoCount: photoCount,
        coverImageUrl: coverImageUrl
      };
    });

    // 3. Renderiza a nova página EJS, passando os álbuns formatados
    res.render('my-albums', {
      user: req.user,
      albums: formattedAlbums,
      error: req.query.error,
      success: req.query.success
    });

  } catch (error) {
    console.error('Erro ao carregar a página de álbuns:', error);
    res.redirect('/dashboard?error=Não foi possível carregar seus álbuns.');
  }
});

// ROTA GET para acessar conteúdo compartilhado via token 
router.get('/share/:shareToken', async (req, res) => {
  try {
    const { shareToken } = req.params;

    const shareRecord = await db.Share.findOne({
      where: { shareToken: shareToken },
      include: [
        { model: db.User, as: 'owner', attributes: ['username'] },
        { model: db.User, as: 'sharedWith', attributes: ['username', 'email'] }
      ]
    });

    if (!shareRecord) {
      return res.status(404).send('Link de compartilhamento inválido ou expirado.');
    }

    // 1. Verificar expiração
    if (shareRecord.expiresAt && new Date() > shareRecord.expiresAt) {
      return res.status(403).send('Este link de compartilhamento expirou.');
    }

    // 2. Verificar permissão de acesso (se não for público)
    if (!shareRecord.isPublic) {
      if (!req.isAuthenticated()) {
        // Redireciona para login se não for público e o usuário não estiver logado
        return res.redirect(`/login?error=${encodeURIComponent('Você precisa estar logado para acessar este conteúdo compartilhado.')}`);
      }
      // Se está logado, verifica se foi compartilhado com ele ou se ele é o dono
      if (req.user.id !== shareRecord.ownerId && req.user.id !== shareRecord.sharedWithUserId) {
        return res.status(403).send('Você não tem permissão para visualizar este conteúdo. Ele foi compartilhado com outro usuário.');
      }
    }

    // 3. Buscar o conteúdo real (foto, álbum, tag, categoria)
    let content = null;
    let viewToRender = 'shared-content'; // Template genérico ou ajuste conforme o tipo
    let templateData = { 
        shareRecord: shareRecord,
        ownerUsername: shareRecord.owner ? shareRecord.owner.username : 'desconhecido'
    };

    if (shareRecord.contentType === 'photo') {
      content = await db.Photo.findByPk(shareRecord.contentId, {
        include: [
          { model: db.User, as: 'user', attributes: ['username'] },
          { model: db.Tag, as: 'tags', attributes: ['name'], through: { attributes: [] } },
          { model: db.Category, as: 'categories', attributes: ['name'], through: { attributes: [] } },
          { model: db.Album, as: 'albums', attributes: ['name'], through: { attributes: [] } }
        ]
      });
      viewToRender = 'photo'; // Reutiliza seu template de foto para uma única foto compartilhada
      templateData.photo = content; // Passa a foto como 'photo' para o EJS
      templateData.isSharedView = true; // Flag para o EJS saber que é uma view compartilhada
    } else if (shareRecord.contentType === 'album') {
      content = await db.Album.findByPk(shareRecord.contentId, {
        include: [{ 
            model: db.Photo, 
            as: 'photos', 
            include: [{ model: db.Tag, as: 'tags', attributes: ['name'], through: { attributes: [] }}] // Inclui tags das fotos do álbum
        }],
        order: [[db.Photo, 'uploadDate', 'DESC']] // Ordena as fotos dentro do álbum
      });
      viewToRender = 'shared-album'; // Você precisaria criar este template para um álbum compartilhado
      templateData.album = content;
      templateData.isSharedView = true;
    } else if (shareRecord.contentType === 'tag') {
        const tagContent = await db.Tag.findByPk(shareRecord.contentId);
        if (tagContent) {
            content = await db.Photo.findAll({
                include: [{
                    model: db.Tag,
                    as: 'tags',
                    where: { id: tagContent.id },
                    attributes: [],
                    through: { attributes: [] },
                    required: true
                }, { model: db.User, as: 'user', attributes: ['username'] }],
                where: { userId: shareRecord.ownerId || { [Op.ne]: null } }, // Opcional: filtrar por fotos do owner ou todas
                order: [['uploadDate', 'DESC']]
            });
            viewToRender = 'shared-tag-category'; // Template para exibir várias fotos por tag/categoria
            templateData.tag = tagContent;
            templateData.photos = content;
            templateData.isSharedView = true;
        }
    } else if (shareRecord.contentType === 'category') {
        const categoryContent = await db.Category.findByPk(shareRecord.contentId);
        if (categoryContent) {
            content = await db.Photo.findAll({
                include: [{
                    model: db.Category,
                    as: 'categories',
                    where: { id: categoryContent.id },
                    attributes: [],
                    through: { attributes: [] },
                    required: true
                }, { model: db.User, as: 'user', attributes: ['username'] }],
                where: { userId: shareRecord.ownerId || { [Op.ne]: null } }, // Opcional: filtrar por fotos do owner ou todas
                order: [['uploadDate', 'DESC']]
            });
            viewToRender = 'shared-tag-category'; // Reutiliza
            templateData.category = categoryContent;
            templateData.photos = content;
            templateData.isSharedView = true;
        }
    }

    if (!content) {
      return res.status(404).send('Conteúdo compartilhado não encontrado ou não disponível.');
    }

    // Renderiza o template apropriado com os dados do conteúdo
    res.render(viewToRender, templateData);

  } catch (error) {
    console.error('Erro ao acessar conteúdo compartilhado:', error);
    res.status(500).send('Ocorreu um erro ao carregar o conteúdo compartilhado. Tente novamente.');
  }
});


// --------- ROTAS POST ---------

// POST register page
router.post('/register', async function(req, res, next) {
  const { username, email, password } = req.body;

  try {
    // 1. Validação básica (campos vazios)
    if (!username || !email || !password) {
      return res.redirect('/register?error=' + encodeURIComponent('Por favor, preencha todos os campos.'));
    }

    // 2. Verificar se o e-mail já existe
    const existingEmail = await db.User.findOne({ where: { email: email } });
    if (existingEmail) {
      return res.redirect('/register?error=' + encodeURIComponent('Este e-mail já está em uso.'));
    }

    // 3. Verificar se o nome de usuário já existe
    const existingUsername = await db.User.findOne({ where: { username: username } });
    if (existingUsername) {
      return res.redirect('/register?error=' + encodeURIComponent('Este nome de usuário já está em uso.'));
    }

    // 4. Criar o novo usuário (a senha será hashed automaticamente pelo hook do modelo)
    // isVerified será false por padrão, verificationToken será gerado automaticamente
    const newUser = await db.User.create({
      username,
      email,
      password,
      isVerified: false // Garante que o usuário não está verificado inicialmente
    });

    // 5. Enviar e-mail de verificação
    const verificationLink = `${req.protocol}://${req.get('host')}/verify-email/${newUser.verificationToken}`;
    
    await mailTransporter.sendMail({
      from: process.env.EMAIL_USER, // Seu e-mail configurado no .env
      to: newUser.email,
      subject: 'Verifique seu e-mail para o PhotoOrganizer',
      html: `
        <p>Olá ${newUser.username},</p>
        <p>Obrigado por se registrar no PhotoOrganizer!</p>
        <p>Por favor, clique no link abaixo para verificar seu e-mail e ativar sua conta:</p>
        <p><a href="${verificationLink}">${verificationLink}</a></p>
        <p>Este link expira em 24 horas.</p>
        <p>Atenciosamente,<br/>A Equipe PhotoOrganizer</p>
      `,
    });

    console.log(`E-mail de verificação enviado para ${newUser.email}`);
    // Redireciona para uma página informando que o e-mail de verificação foi enviado
    return res.redirect('/register?needsVerification=true&email=' + encodeURIComponent(newUser.email));

  } catch (error) {
    console.error('Erro no registro do usuário ou envio de e-mail:', error);
    // Para erros de Nodemailer, pode ser mais específico
    let errorMessage = 'Ocorreu um erro ao registrar. Tente novamente.';
    if (error.code === 'EENVELOPE' || error.code === 'EAUTH') { // Exemplo de erros comuns do Nodemailer
        errorMessage = 'Erro ao enviar o e-mail de verificação. Verifique sua configuração de e-mail.';
    }
    return res.redirect('/register?error=' + encodeURIComponent(errorMessage));
  }
});

//POST login
router.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard', // Redireciona para o dashboard em caso de sucesso
  failureRedirect: '/login?error=Email ou senha inválidos.',
  failureFlash: false
}));

// POST Enviar e-mail de redefinição de senha
router.post('/forgot-password', async function(req, res, next) {
  const { email } = req.body;

  try {
    if (!email) {
      return res.redirect('/forgot-password?error=' + encodeURIComponent('Por favor, informe seu e-mail.'));
    }

    const user = await db.User.findOne({ where: { email: email } });
    if (!user) {
      // Para segurança, sempre retorne uma mensagem genérica para não vazar se o e-mail existe
      console.log(`Tentativa de redefinição de senha para e-mail não encontrado: ${email}`);
      return res.redirect('/forgot-password?success=' + encodeURIComponent('Se o e-mail estiver registrado, você receberá um link de redefinição de senha.'));
    }
    
    // 1. Gerar um token único e definir expiração (ex: 1 hora)
    const resetToken = uuidv4();
    const resetExpires = new Date(Date.now() + 3600000); // Token válido por 1 hora

    await user.update({
      passwordResetToken: resetToken,
      passwordResetExpires: resetExpires,
    });

    // 2. Enviar e-mail com o link de redefinição
    const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;

    await mailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Redefinição de Senha do PhotoOrganizer',
      html: `
        <p>Olá ${user.username},</p>
        <p>Você solicitou a redefinição da sua senha no PhotoOrganizer.</p>
        <p>Por favor, clique no link abaixo para redefinir sua senha:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>Este link é válido por 1 hora.</p>
        <p>Se você não solicitou esta redefinição, por favor, ignore este e-mail.</p>
        <p>Atenciosamente,<br/>A Equipe PhotoOrganizer</p>
      `,
    });

    console.log(`E-mail de redefinição de senha enviado para ${user.email}`);
    res.redirect('/forgot-password?success=' + encodeURIComponent('Se o e-mail estiver registrado, você receberá um link de redefinição de senha.'));

  } catch (error) {
    console.error('Erro ao solicitar redefinição de senha:', error);
    res.redirect('/forgot-password?error=' + encodeURIComponent('Ocorreu um erro ao processar sua solicitação. Tente novamente.'));
  }
});

// POST Redefinir a senha 
router.post('/reset-password/:token', async function(req, res) {
  const { token } = req.params;
  const { password, confirm_password } = req.body;

  try {
    // 1. Validar senhas
    if (!password || password.length < 6) {
      return res.redirect(`/reset-password/${token}?error=${encodeURIComponent('A senha deve ter no mínimo 6 caracteres.')}`);
    }
    if (password !== confirm_password) {
      return res.redirect(`/reset-password/${token}?error=${encodeURIComponent('As senhas não coincidem.')}`);
    }

    // 2. Encontrar o usuário pelo token (e verificar expiração novamente)
    const user = await db.User.findOne({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { [Op.gt]: new Date() }
      }
    });

    if (!user) {
      return res.redirect(`/reset-password/${token}?error=${encodeURIComponent('O link de redefinição é inválido ou expirou. Por favor, solicite um novo.')}`);
    }

    // 3. Atualizar a senha e invalidar o token
    // O hook beforeUpdate do seu modelo User fará o hash da nova senha
    await user.update({
      password: password,
      passwordResetToken: null, // Invalida o token
      passwordResetExpires: null, // Remove a expiração
    });

    console.log(`Senha redefinida com sucesso para o usuário: ${user.username}`);
    res.redirect('/login?success=' + encodeURIComponent('Sua senha foi redefinida com sucesso! Por favor, faça login com sua nova senha.'));

  } catch (error) {
    console.error('Erro ao redefinir a senha:', error);
    res.redirect(`/reset-password/${token}?error=${encodeURIComponent('Ocorreu um erro ao redefinir sua senha. Tente novamente.')}`);
  }
});

//POST: /profile/edit 
// avatarUpload.single('new_avatar_file') para processar o upload do arquivo de avatar, se houver.
router.post('/profile/edit', isAuthenticated, avatarUpload.single('new_avatar_file'), async function(req, res, next) {
  try {
    const user = req.user;
    const { username, bio, avatar_source, existing_photo_id } = req.body;
    let newAvatarUrl = user.avatarUrl;

    if (!username || username.trim() === '') {
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
            return res.redirect('/profile/edit?error=Foto existente selecionada inválida.');
        }
    } else if (avatar_source === 'upload') {
        if (!req.file) { // Se esta condição for verdadeira, o Multer não processou o arquivo
            return res.redirect('/profile/edit?error=Nenhum arquivo de avatar foi enviado para upload.');
        }
        newAvatarUrl = '/uploads/avatars/' + req.file.filename;
    } else if (avatar_source === 'current') {
        // Nada a fazer, newAvatarUrl já tem o valor atual
    } else {
        // Cenário para onde nenhum radio foi selecionado, ou valor inválido
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

// ROTA POST SHARE 
router.post('/share', isAuthenticated, upload.none(), async (req, res) => {
  try {
     console.log('[POST /share] -- INÍCIO DA ROTA DE COMPARTILHAMENTO --');
     console.log('[POST /share] Conteúdo COMPLETO do req.body (raw):', JSON.stringify(req.body, null, 2));
     console.log('[POST /share] Itens selecionados recebidos (string JSON):', req.body.selectedItems); // Este deve ser a string JSON
    
     // Garante que selectedItemsString não é undefined antes de tentar parsear
    const selectedItemsString = req.body.selectedItems || '[]'; // Se for undefined, usa '[]'


     let parsedSelectedItems;
     try {
       parsedSelectedItems = JSON.parse(selectedItemsString); 
     } catch (parseError) {
      console.error('[POST /share] ERRO ao parsear selectedItems JSON:', parseError);
      // Retorna um erro JSON legível para o frontend
       return res.status(400).json({ error: 'Erro nos dados de seleção. Formato inválido. Tente novamente.' });
  }



  const ownerId = req.user.id;
    const { recipientEmail, isPublic, expiresAt } = req.body;

    const isPublicChecked = isPublic === 'on' || isPublic === true; 
    const trimmedRecipientEmail = recipientEmail ? recipientEmail.trim() : '';

    
    if (!parsedSelectedItems || parsedSelectedItems.length === 0) {
      // CORREÇÃO: Retorna JSON
      return res.status(400).json({ error: 'Nenhum item selecionado para compartilhar.' });
    }

    if (!isPublicChecked && !trimmedRecipientEmail) {
      // CORREÇÃO: Retorna JSON
      return res.status(400).json({ error: 'Para compartilhamento interno, o e-mail do destinatário é obrigatório.' });
    }

    let sharedWithUser = null;
    if (trimmedRecipientEmail && !isPublicChecked) {
        sharedWithUser = await db.User.findOne({ where: { email: trimmedRecipientEmail } });
        if (!sharedWithUser) {
            // CORREÇÃO: Retorna JSON
            return res.status(404).json({ error: 'Usuário destinatário não encontrado para compartilhamento interno.' });
        }
    }

    let shareLinks = []; 
    let itemsProcessed = 0;

    for (const item of parsedSelectedItems) {
      console.log(`[POST /share] Processando item: ID=${item.id}, Type=${item.type}`);
      let contentModel;
      let contentType;
      let validationError = null;

      if (item.type === 'photo') {
        contentModel = db.Photo;
        contentType = 'photo';
      } else if (item.type === 'album') {
        contentModel = db.Album;
        contentType = 'album';
      } else if (item.type === 'tag') { 
        contentModel = db.Tag;
        contentType = 'tag';
      } else if (item.type === 'category') { 
        contentModel = db.Category;
        contentType = 'category';
      } else {
        console.warn(`[POST /share] Tipo de conteúdo inválido para compartilhamento: ${item.type}`);
        validationError = `Tipo de item inválido: ${item.type}`;
      }

      if (validationError) {
          // CORREÇÃO: Retorna JSON para erro de validação de item individual
          shareLinks.push({ id: item.id, type: item.type, error: validationError });
          // Não continue o loop com 'continue' se quiser falhar todo o pedido
          // Ou colete todos os erros e retorne no final.
          // Para este caso, se um item for inválido, vamos considerar um erro geral:
          return res.status(400).json({ error: `Erro no item ${item.id}: ${validationError}` });
      }

      const content = await contentModel.findByPk(item.id);
      if (!content || (content.userId && content.userId !== ownerId && contentType !== 'tag' && contentType !== 'category')) {
          console.warn(`[POST /share] Item ${item.type} com ID ${item.id} não encontrado ou não pertence ao usuário ${ownerId}.`);
          // CORREÇÃO: Retorna JSON
          return res.status(403).json({ error: 'Item não encontrado ou não autorizado para compartilhamento.' });
      }
      
      const newShare = await db.Share.create({
        ownerId: ownerId,
        sharedWithUserId: sharedWithUser ? sharedWithUser.id : null,
        contentType: contentType,
        contentId: item.id,
        isPublic: isPublicChecked, 
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      const shareLink = `${req.protocol}://${req.get('host')}/share/${newShare.shareToken}`;
      shareLinks.push({ id: item.id, type: item.type, shareLink: shareLink, token: newShare.shareToken });
      itemsProcessed++;
    }

    if (itemsProcessed > 0) {
      if (isPublicChecked) {
        // Retorna JSON para link público
        return res.status(200).json({ 
          success: 'Links de compartilhamento gerados com sucesso!',
          shareLink: shareLinks[0].shareLink,
          allShareLinks: shareLinks
        });
      } else {
        if (sharedWithUser) {
            const emailSubject = `[PhotoOrganizer] Conteúdo compartilhado por ${req.user.username}`;
            const emailBody = `
                <p>Olá ${sharedWithUser.username},</p>
                <p>Você recebeu conteúdo compartilhado de ${req.user.username} no PhotoOrganizer.</p>
                <p>Clique nos links abaixo para visualizar:</p>
                <ul>
                    ${shareLinks.map(link => `<li><a href="${link.shareLink}">${link.shareLink}</a></li>`).join('')}
                </ul>
                <p>Estes links são privados e podem expirar. Você precisa estar logado na sua conta PhotoOrganizer para acessá-los.</p>
                <p>Atenciosamente,<br/>A Equipe PhotoOrganizer</p>
            `;

            await mailTransporter.sendMail({
                from: process.env.EMAIL_USER,
                to: sharedWithUser.email,
                subject: emailSubject,
                html: emailBody,
            });
            console.log(`[POST /share] E-mail de compartilhamento enviado para ${sharedWithUser.email}`);
            // Retorna JSON para sucesso de compartilhamento por e-mail
            return res.status(200).json({ message: 'Conteúdo compartilhado por e-mail com sucesso!' });
        } else {
            // CORREÇÃO: Retorna JSON
            return res.status(404).json({ error: 'Usuário destinatário não encontrado para enviar e-mail.' });
        }
      }
    } else {
        // CORREÇÃO: Retorna JSON
        return res.status(400).json({ error: 'Nenhum item válido foi processado para compartilhamento.' });
    }

  } catch (error) {
    console.error('[POST /share] ERRO FATAL AO CRIAR COMPARTILHAMENTO:', error);
    console.error('[POST /share] Stack trace do erro:', error.stack);

    let errorMessage = 'Ocorreu um erro interno ao compartilhar os itens. Tente novamente.';
    // ... (restante do tratamento de erro existente, que já retorna JSON) ...
    if (error instanceof multer.MulterError) {
        errorMessage = error.message;
    } else if (error.message.includes('Apenas arquivos de imagem são permitidos')) { 
        errorMessage = error.message;
    } else if (error.name === 'SequelizeValidationError' && error.errors && error.errors.length > 0) {
        errorMessage = error.errors.map(e => e.message).join('; ');
    } else if (error.code === 'EENVELOPE' || error.code === 'EAUTH') { 
        errorMessage = 'Erro ao enviar o e-mail de compartilhamento. Verifique sua configuração de e-mail.';
    } else if (error.name === 'TypeError' && error.message.includes('sendMail is not a function')) {
        errorMessage = 'Erro de configuração do serviço de e-mail.';
    } else if (error.name === 'SyntaxError' && error.message.includes('valid JSON')) {
        errorMessage = 'Erro na formatação dos dados de seleção. Tente novamente.';
    } else {
        errorMessage = 'Ocorreu um erro inesperado. Verifique os logs do servidor para mais detalhes.';
    }

    res.status(500).json({ error: errorMessage });
  }
});


module.exports = router;