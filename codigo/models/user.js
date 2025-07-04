// models/user.js
const bcrypt = require('bcryptjs'); 

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
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
          isUrl: true, // Opcional: valida se é uma URL
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