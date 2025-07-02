// models/photo.js
module.exports = (sequelize, DataTypes) => {
  const Photo = sequelize.define('Photo', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    filepath: { // Caminho no servidor onde a imagem está salva
      type: DataTypes.STRING,
      allowNull: false,
    },
    mimetype: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    uploadDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    location: { // Exemplo de metadado
      type: DataTypes.STRING,
      allowNull: true,
    },
    equipment: { // Exemplo de metadado
      type: DataTypes.STRING,
      allowNull: true,
    },
  });

  Photo.associate = (models) => {
    Photo.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user',
    });
    Photo.belongsToMany(models.Album, {
      through: 'PhotoAlbum',
      foreignKey: 'photoId',
      as: 'albums',
    });
    Photo.belongsToMany(models.Category, {
      through: 'PhotoCategory',
      foreignKey: 'photoId',
      as: 'categories',
    });
    Photo.belongsToMany(models.Tag, {
      through: 'PhotoTag',
      foreignKey: 'photoId',
      as: 'tags',
    });
  };

  return Photo;
};