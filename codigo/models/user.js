// models/user.js
const bcrypt = require('bcryptjs'); 
const { v4: uuidv4 } = require('uuid'); // Para gerar tokens UUID

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {

    isVerified: { // Novo campo: true se o e-mail foi verificado
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    verificationToken: { // Novo campo: Token para verificação de e-mail
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4, // Gera um UUID automaticamente
      unique: true, // Garante que o token é único
      allowNull: true, // Pode ser nulo após verificação
    },
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    password: { // Armazenará o hash da senha
      type: DataTypes.STRING,
      allowNull: false,
    }, 
    passwordResetToken: {
      type: DataTypes.STRING, // String para tokens (UUID ou similar)
      allowNull: true, // Pode ser nulo se não houver token ativo
      unique: true, // Garante que o token é único
    },
    passwordResetExpires: {
      type: DataTypes.DATE, // Data/hora de expiração do token
      allowNull: true, // Pode ser nulo
    },
     bio: {
      type: DataTypes.TEXT,
      allowNull: true, // Biografia é opcional
    },
    subscriptionPlan: {
      type: DataTypes.STRING,
      defaultValue: 'Gratuito', // Plano padrão
    },
     avatarUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
      }
     }
  }, {
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
    },
  });

  User.prototype.validPassword = async function(password) {
    return await bcrypt.compare(password, this.password);
  };

  User.associate = (models) => {
    User.hasMany(models.Photo, {
      foreignKey: 'userId',
      as: 'photos',
      onDelete: 'CASCADE',
    });
    User.hasMany(models.Album, {
      foreignKey: 'userId',
      as: 'albums',
      onDelete: 'CASCADE',
    });
  };

  return User;
};