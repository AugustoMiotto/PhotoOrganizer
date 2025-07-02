// models/category.js
module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define('Category', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true, // Categorias devem ser únicas
    },
  });

  Category.associate = (models) => {
    Category.belongsToMany(models.Photo, {
      through: 'PhotoCategory',
      foreignKey: 'categoryId',
      as: 'photos',
    });
  };

  return Category;
};