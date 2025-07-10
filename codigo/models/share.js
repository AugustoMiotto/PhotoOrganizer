module.exports = (sequelize, DataTypes) => {
  const Share = sequelize.define('Share', {
    id: { // ID único do registro de compartilhamento
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    shareToken: { // Token único para o link de compartilhamento (UUID, por exemplo)
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      unique: true,
      allowNull: false,
    },
    ownerId: { // ID do usuário que iniciou o compartilhamento
      type: DataTypes.UUID,
      allowNull: false,
    },
    sharedWithUserId: { // ID do usuário com quem foi explicitamente compartilhado (se não for público)
      type: DataTypes.UUID,
      allowNull: true, // Permite nulo se for compartilhamento público, ou com múltiplos usuários
    },
    // Você pode ter uma tabela de junção ShareUser se compartilhar com muitos usuários.
    // Por enquanto, vamos considerar share com UM usuário, ou link público.

    contentType: { // Tipo de conteúdo compartilhado: 'photo', 'album', 'tag', 'category'
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [['photo', 'album', 'tag', 'category']],
      }
    },
    contentId: { // ID do item compartilhado (ID da foto, álbum, tag, ou categoria)
      type: DataTypes.UUID,
      allowNull: false,
    },
    expiresAt: { // Data de expiração do link (opcional, para links temporários)
      type: DataTypes.DATE,
      allowNull: true,
    },
    isPublic: { // true se for um link público para qualquer um; false se restrito
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
  });

  Share.associate = (models) => {
    Share.belongsTo(models.User, { foreignKey: 'ownerId', as: 'owner' });
    Share.belongsTo(models.User, { foreignKey: 'sharedWithUserId', as: 'sharedWith' });

    // Associações polimórficas (ou você pode fazer mais genérico)
    // Para simplificar, não faremos belongsTo para Photo, Album, etc. direto no Share,
    // apenas armazenaremos o contentId e contentType. A busca é feita manualmente.
  };

  return Share;
};