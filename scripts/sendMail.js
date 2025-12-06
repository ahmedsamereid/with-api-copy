
const nodemailer = require('nodemailer');

// إعداد الـ transporter باستخدام Gmail و App Password
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'samerahmed496@gmail.com', // صحح الإيميل لو فيه خطأ
    pass: 'djal jahw vjvw aqdg', // App Password اللي أنشأته
  },
});

async function sendMail() {
  try {
    const info = await transporter.sendMail({
      from: '"IP App" <samerahmed496@gmail.com>', // اسم التطبيق
      to: 'samerahmed496@gmail.com', // الإيميل المستلم
      subject: 'Test Email from IP App',
      text: 'Hello Ahmed, this is a test email sent using your App Password!',
      html: '<h1>Hello Ahmed</h1><p>This is a <b>test email</b> sent using your App Password!</p>',
      attachments: [
        {
          filename: 'test.txt',
          content: 'This is a sample attachment file.',
        },
      ],
    });

    console.log('✅ Email sent successfully:', info.messageId);
  } catch (error) {
    console.error('❌ Failed to send email:', error);
  }
}

// استدعاء الدالة
sendMail();
