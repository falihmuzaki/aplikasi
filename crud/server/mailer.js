import nodemailer from 'nodemailer'

// Pengiriman OTP via email (SMTP) dengan fallback aman ke mode development.
//
// Pendekatan:
// - "SMTP terkonfigurasi" ditentukan oleh keberadaan MAIL_HOST + MAIL_USERNAME +
//   MAIL_PASSWORD (semua non-kosong). Ini minimal yang dibutuhkan untuk connect
//   dan autentikasi ke server SMTP.
// - Jika SMTP TIDAK terkonfigurasi: jangan sentuh jaringan. Cetak baris
//   `[DEV OTP] ...` persis seperti perilaku lama agar login dev tetap bisa jalan,
//   plus satu catatan bahwa mail berjalan di mode development/log.
// - Jika SMTP terkonfigurasi: kirim email lewat nodemailer. Saat sukses, kode
//   mentah TIDAK pernah dicetak ke console. Saat gagal, error di-log (bukan kode,
//   bukan password) dan ditelan (tidak di-throw) supaya kontrak respons HTTP di
//   call site tidak berubah (tetap enumeration-safe, OTP sudah tersimpan sebelum
//   pengiriman dicoba).
//
// `index.js` sudah memanggil `import 'dotenv/config'`, jadi process.env.MAIL_*
// sudah terisi saat modul ini dipakai; modul ini tidak perlu memuat dotenv lagi.

function readMailConfig() {
  const host = String(process.env.MAIL_HOST || '').trim()
  const username = String(process.env.MAIL_USERNAME || '').trim()
  const password = String(process.env.MAIL_PASSWORD || '').trim()
  const port = Number(process.env.MAIL_PORT || 587)
  const encryption = String(process.env.MAIL_ENCRYPTION || '').trim().toLowerCase()
  const fromAddress = String(process.env.MAIL_FROM_ADDRESS || username).trim()
  const fromName = String(process.env.MAIL_FROM_NAME || 'Lumina').trim()
  // secure=true untuk SMTPS (port 465 / MAIL_ENCRYPTION=ssl); selain itu
  // secure=false dan nodemailer memakai STARTTLS (umumnya port 587/tls).
  const secure = port === 465 || encryption === 'ssl'
  return { host, port, username, password, encryption, fromAddress, fromName, secure }
}

function isSmtpConfigured(config) {
  return Boolean(config.host && config.username && config.password)
}

// Transporter dibuat sekali (lazy singleton) saat pertama kali dibutuhkan, bukan
// saat import, supaya server tetap boot bersih ketika MAIL_* belum diisi.
let transporter = null

function getTransporter(config) {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    })
  }
  return transporter
}

function buildMessage({ code, purpose }) {
  const isReset = purpose === 'reset'
  const intro = isReset
    ? 'Berikut kode OTP untuk mereset password akun Lumina Anda.'
    : 'Berikut kode OTP untuk menyelesaikan proses masuk ke akun Lumina Anda.'
  const subject = 'Kode OTP Lumina'
  const text = [
    intro,
    '',
    `Kode OTP: ${code}`,
    '',
    'Kode berlaku selama 10 menit dan hanya bisa dipakai sekali.',
    'Abaikan email ini jika Anda tidak meminta kode tersebut.',
    '',
    '— Lumina',
  ].join('\n')
  const html = [
    `<p>${intro}</p>`,
    `<p style="font-size:24px;font-weight:bold;letter-spacing:4px;margin:16px 0">${code}</p>`,
    '<p>Kode berlaku selama 10 menit dan hanya bisa dipakai sekali.</p>',
    '<p>Abaikan email ini jika Anda tidak meminta kode tersebut.</p>',
    '<p style="color:#888">— Lumina</p>',
  ].join('')
  return { subject, text, html }
}

// Fallback dev: cetak baris persis seperti perilaku lama di index.js.
function logDevOtp({ to, code, purpose }) {
  if (purpose === 'reset') {
    console.log(`[DEV OTP] Kode reset password untuk ${to}: ${code}`)
  } else {
    console.log(`[DEV OTP] Kode login untuk ${to}: ${code}`)
  }
  console.log('[MAIL] SMTP belum dikonfigurasi (MAIL_* kosong). OTP dicetak ke console (mode development).')
}

export async function sendOtpEmail({ to, code, purpose }) {
  const config = readMailConfig()

  if (!isSmtpConfigured(config)) {
    logDevOtp({ to, code, purpose })
    return
  }

  const { subject, text, html } = buildMessage({ code, purpose })
  const from = config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress

  try {
    await getTransporter(config).sendMail({ from, to, subject, text, html })
    // Sukses: JANGAN mencetak kode mentah.
  } catch (error) {
    // Jangan pernah log kode OTP atau password SMTP di sini.
    console.error(`[MAIL] Gagal mengirim OTP ke ${to}: ${error.message}`)
    // Error ditelan agar kontrak respons HTTP tidak berubah (enumeration-safe).
  }
}
