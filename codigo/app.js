const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const indexRouter = require('./routes/index');
const app = express();

// importações para sessão e autenticação
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy; // Estratégia de login local
// Carrega as constiáveis de ambiente
require('dotenv').config();

// Importa a instância do Sequelize e os modelos
const db = require('./models');


//  Configuração do Passport.js 

// Configuração da estratégia local
passport.use(new LocalStrategy(
  { usernameField: 'username' }, // O campo que será usado como "username" no seu formulário de login (pode ser username ou email)
  async function(email, password, done) {
    try {
      const user = await db.User.findOne({ where: { email: email } });
      if (!user) {
        return done(null, false, { message: 'Email não encontrado.' });
      }
      const isValidPassword = await user.validPassword(password); // Método que criamos no modelo User
      if (!isValidPassword) {
        return done(null, false, { message: 'Senha incorreta.' });
      }
      return done(null, user); // Usuário autenticado com sucesso
    } catch (err) {
      return done(err);
    }
  }
));

// Serialização do usuário: o que será armazenado na sessão (normalmente, apenas o ID do usuário)
passport.serializeUser(function(user, done) {
  done(null, user.id);
});

// Desserialização do usuário: como recuperar o usuário a partir do ID na sessão
passport.deserializeUser(async function(id, done) {
  try {
    const user = await db.User.findByPk(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});



// Sincroniza o banco de dados
db.sequelize.sync({ force: false }) 
  .then(() => {
    console.log('Banco de dados sincronizado com sucesso!');
  })
  .catch(err => {
    console.error('Erro ao sincronizar o banco de dados:', err);
  });


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Middlewares de sessão e Passport.js ---
app.use(session({
  secret: process.env.SESSION_SECRET || 'sua_secret_muito_segura', // Use uma string forte e do .env
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // Sessão expira em 24 horas
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/', indexRouter);


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
