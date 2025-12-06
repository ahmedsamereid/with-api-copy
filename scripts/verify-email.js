
/**
 * scripts/verify-email.js
 * ?????? ????? Gmail OAuth2
 */
require('dotenv').config();
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

async function createTransport() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const accessToken = await oAuth2Client.getAccessToken();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.GMAIL_USER,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      accessToken: accessToken?.token || accessToken,
    },
  });
}

(async () => {
  try {
    const transport = await createTransport();
    const info = await transport.sendMail({
      from: `"Telemetry Bot" <${process.env.GMAIL_USER}>`,
      to: process.env.MAIL_TO || process.env.GMAIL_USER,
      subject: '?????? ????? Gmail OAuth2',
      text: '?? ??????? ????? ??? OAuth2.',
    });
    console.log('? sent', info.messageId);
  } catch (e) {
    console.error('? failed', e.message);
    process.exit(1);
  }
})();