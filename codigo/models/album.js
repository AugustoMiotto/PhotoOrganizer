// models/album.js
module.exports = (sequelize, DataTypes) => {
  const Album = sequelize.define('Album', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  Album.associate = (models) => {
    Album.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user',
    });
    Album.belongsToMany(models.Photo, {
      through: 'PhotoAlbum',
      foreignKey: 'albumId',
      as: 'photos',
    });
  };

  return Album;
};