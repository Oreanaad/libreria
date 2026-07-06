// Testing-only mailer: sends through an auto-generated Ethereal account
// (nodemailer's fake SMTP inbox — nothing is actually delivered). Each send
// returns a preview URL so you can see the rendered email in a browser.
// Swap this out for a real provider before onboarding real customers.
const nodemailer = require('nodemailer');

let transporterPromise = null;

function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = nodemailer.createTestAccount().then(account =>
      nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass }
      })
    );
  }
  return transporterPromise;
}

async function sendPasswordResetEmail(to, resetUrl) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: '"Booksflea" <no-reply@booksflea.test>',
    to,
    subject: 'Restablecé tu contraseña — Booksflea',
    html: `
      <div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px;color:#2E2820">
        <h2 style="color:#2B2216">📖 Booksflea</h2>
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${resetUrl}" style="background:#B8863E;color:#fff;padding:12px 24px;border-radius:100px;text-decoration:none;display:inline-block;font-weight:bold">Restablecer contraseña</a></p>
        <p style="font-size:.85rem;color:#746754">Este enlace vence en 1 hora. Si no pediste esto, ignorá este correo.</p>
      </div>`
  });
  return { previewUrl: nodemailer.getTestMessageUrl(info) };
}

module.exports = { sendPasswordResetEmail };
