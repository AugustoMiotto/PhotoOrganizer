// models/tag.js
module.exports = (sequelize, DataTypes) => {
  const Tag = sequelize.define('Tag', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true, // Tags devem ser únicas
    },
  });

  Tag.associate = (models) => {
    Tag.belongsToMany(models.Photo, {
      through: 'PhotoTag',
      foreignKey: 'tagId',
      as: 'photos',
    });
  };

  return Tag;
};