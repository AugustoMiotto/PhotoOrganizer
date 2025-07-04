const express = require('express');
const router = express.Router();
const passport = require('passport');
const db = require('../models');

// --------- ROTAS GET ---------

// GET register page (home)
router.get('/', function(req, res, next) {
  res.render('register');
});



// GET login page
router.get('/login', function(req,res,next){
  res.render('login');
});

// GET dashboard
router.get('/dashboard', function(req,res,next){
  res.render('dashboard');
});

// Get profile

router.get('/profile', function(req,res,next){
  res.render('profile');
});


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
      password // O hook beforeCreate no modelo User fará o hash da senha aqui
    });

    // 5. Autenticar o usuário recém-criado e iniciar a sessão
    req.login(newUser, function(err) {
      if (err) {
        console.error('Erro ao fazer login após o registro:', err);
        return next(err); // Passa o erro para o próximo middleware de tratamento de erros
      }
      // Redireciona para o dashboard após o login bem-sucedido
      return res.redirect('/?success=Registro realizado com sucesso e login efetuado!');
    });

  } catch (error) {
    console.error('Erro no registro do usuário:', error);
    // Em caso de erro (ex: validação do Sequelize), redireciona com mensagem de erro
    return res.redirect('/register?error=Ocorreu um erro ao registrar. Tente novamente.');
  }
});

//POST login
router.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard', // Redireciona para o dashboard em caso de sucesso
  failureRedirect: '/login?error=Email ou senha inválidos.', // Redireciona para a página de login em caso de falha
  failureFlash: false // Desabilita mensagens flash do Passport, já que estamos usando query params
}));

// GET logout
router.get('/logout', function(req, res, next) {
  req.logout(function(err) { // req.logout() requer uma callback a partir do Express-session 1.x
    if (err) { return next(err); }
    res.redirect('/login?success=Você foi desconectado.');
  });
});

module.exports = router;
