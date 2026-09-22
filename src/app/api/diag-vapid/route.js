// DIAGNOSTIK SEMENTARA — hapus setelah isu VAPID selesai.
// Laporkan HANYA boolean keberadaan env di runtime (tanpa nilai rahasia).
export async function GET() {
  return Response.json({
    publicKey: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    privateKey: Boolean(process.env.VAPID_PRIVATE_KEY),
    subject: Boolean(process.env.VAPID_SUBJECT),
    nodeEnv: process.env.NODE_ENV,
    // id deployment untuk memastikan kita mengejar deployment yang benar
    vercelEnv: process.env.VERCEL_ENV || null,
  });
}
