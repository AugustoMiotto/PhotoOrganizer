// routes/index.js
const express = require('express');
const router = express.Router();
const passport = require('passport'); 
const db = require('../models');    

// --- Middleware para proteger rotas  ---

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
router.get('/dashboard', isAuthenticated, function(req, res, next) {
  // 'req.user' é o objeto do usuário logado, fornecido pelo Passport
  res.render('dashboard', { user: req.user, success: req.query.success });
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

//GET edit-profile
router.get('/profile/edit', isAuthenticated, async function(req, res, next) {
  try {
    const user = req.user; // O usuário logado

    // Renderiza a página de edição de perfil, passando os dados atuais do usuário
    // O template edit-profile.ejs espera um objeto 'user' para preencher os campos.
    res.render('edit-profile', { 
        user: {
            username: user.username,
            email: user.email,
            bio: user.bio || '',
            avatarUrl: user.avatarUrl || ''
        },
        error: req.query.error, // Para exibir mensagens de erro do redirecionamento
        success: req.query.success // Para exibir mensagens de sucesso do redirecionamento
    });
  } catch (error) {
    console.error('Erro ao carregar página de edição de perfil:', error);
    res.redirect('/profile?error=Não foi possível carregar a página de edição.');
  }
});

// GET Upload (Agora protegida)
router.get('/upload', isAuthenticated, function(req, res, next) {
  res.render('upload', { user: req.user }); // Também passa o usuário se o upload.ejs precisar
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

router.post('/profile/edit', isAuthenticated, async function(req, res, next) {
  try {
    const user = req.user; // O usuário logado
    const { username, bio, avatarUrl } = req.body; // Pega os dados do formulário
    // Note que 'email' não é incluído aqui, pois o input é readonly e não deve ser editado diretamente.

    // 1. Validação dos dados (ex: username não pode estar vazio)
    if (!username || username.trim() === '') {
      return res.redirect('/profile/edit?error=O nome de usuário não pode estar vazio.');
    }

    // 2. Verificar se o novo username já existe (se foi alterado e não é o do próprio usuário)
    if (username !== user.username) {
        const existingUsername = await db.User.findOne({ where: { username: username } });
        if (existingUsername) {
            return res.redirect('/profile/edit?error=Este nome de usuário já está em uso por outro usuário.');
        }
    }

    // 3. Atualizar o usuário no banco de dados
    // Use user.update() para atualizar o usuário diretamente do objeto Passport
    await user.update({
      username: username,
      bio: bio || null, // Se bio estiver vazio, salva como null
      avatarUrl: avatarUrl || null, // Se avatarUrl estiver vazio, salva como null
      // Não atualize email ou senha nesta rota, crie rotas separadas para isso
    });

    console.log('Perfil atualizado com sucesso para:', user.username);

    // 4. Redirecionar para a página de perfil com mensagem de sucesso
    res.redirect('/profile?success=Perfil atualizado com sucesso!');

  } catch (error) {
    console.error('Erro ao atualizar perfil do usuário:', error);
    // Em caso de erro, redireciona de volta para a página de edição com uma mensagem de erro
    res.redirect('/profile/edit?error=Ocorreu um erro ao atualizar o perfil. Tente novamente.');
  }
});

module.exports = router;