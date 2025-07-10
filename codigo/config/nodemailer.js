//Importa o serviço de E-mail
require('dotenv').config();
const nodemailer = require('nodemailer');

// Configuração dele.
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.ethereal.email', // Ou 'smtp.gmail.com'
    port: process.env.EMAIL_PORT || 587,
    secure: process.env.EMAIL_SECURE === 'true', // Use true para 465, false para outros (como 587 com STARTTLS)
    auth: {
        user: process.env.EMAIL_USER || 'seu_email@example.com', // Seu e-mail (ou gerado pelo Ethereal/Mailtrap)
        pass: process.env.EMAIL_PASS || 'sua_senha_email',    // Sua senha de app (para Gmail) ou gerado
    },
});

// Testar conexão (opcional)
transporter.verify(function (error, success) {
    if (error) {
        console.log("Erro ao conectar ao servidor de e-mail:", error);
    } else {
        console.log("Servidor de e-mail pronto para enviar mensagens.");
    }
});

module.exports = transporter;