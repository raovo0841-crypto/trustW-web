/**
 * src/utils/mailer.js
 * Email sending via nodemailer
 * Dev: Ethereal (test emails with preview URL)
 * Prod: Real SMTP (Gmail etc)
 */
const nodemailer = require('nodemailer');

let transporter = null;
let ready = false;

async function getTransporter() {
  if (transporter && ready) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    // Production: real SMTP
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    ready = true;
  } else {
    // Dev: Ethereal test account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass }
    });
    console.log('📧 Ethereal test email account:', testAccount.user);
    ready = true;
  }

  return transporter;
}

/**
 * Send verification code email
 */
async function sendVerificationCode(email, code) {
  const t = await getTransporter();

  const html = `
    <div style="font-family:'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;background:#0b0e11;color:#eaecef;border-radius:8px;overflow:hidden">
      <div style="background:#12161c;padding:24px 32px;border-bottom:1px solid #1e2329">
        <span style="font-size:22px;font-weight:700;color:#eaecef">Trust<span style="color:#f0b90b">Ex</span></span>
      </div>
      <div style="padding:32px">
        <h2 style="margin:0 0 8px;font-size:20px;color:#eaecef">Подтверждение email</h2>
        <p style="color:#848e9c;font-size:14px;line-height:1.6;margin:0 0 24px">Введите этот код на странице подтверждения:</p>
        <div style="background:#181a20;border:1px solid #2b2f36;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#f0b90b">${code}</span>
        </div>
        <p style="color:#5e6673;font-size:12px;line-height:1.6;margin:0">Код действителен 10 минут. Если вы не регистрировались на TrustEx, просто проигнорируйте это письмо.</p>
      </div>
      <div style="background:#12161c;padding:16px 32px;border-top:1px solid #1e2329;text-align:center">
        <span style="color:#5e6673;font-size:11px">&copy; 2024–2026 TrustEx. Все права защищены.</span>
      </div>
    </div>
  `;

  const info = await t.sendMail({
    from: process.env.SMTP_FROM || 'TrustEx <noreply@trustex.com>',
    to: email,
    subject: `${code} — Код подтверждения TrustEx`,
    html
  });

  // Show preview URL in dev (Ethereal)
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`📧 Email preview: ${previewUrl}`);
  }

  return info;
}

module.exports = { sendVerificationCode };
