const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config.js')[env];
const db = {};

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js');
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;

/* INFORMAÇÕES SOBRE OS MODELS:

Usei DataTypes.UUID e DataTypes.UUIDV4 para IDs, que são identificadores únicos globais. 
Isso é ótimo para sistemas distribuídos e evita problemas de colisão de IDs.

As associações (hasMany, belongsTo, belongsToMany) definem os relacionamentos entre suas tabelas. 
O Sequelize criará automaticamente as tabelas de junção (PhotoAlbum, PhotoCategory, PhotoTag).

Adicionei onDelete: 'CASCADE' em User.hasMany para que, ao deletar um usuário, suas fotos e álbuns também sejam deletados.

Incluí bcryptjs no modelo User para fazer o hash da senha automaticamente antes de salvar ou atualizar.
 */