// Заглушка главной; экраны кандидата делает лейн ui в app/(candidate)/.
export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px' }}>
      <h1>ФСП Карьера</h1>
      <p style={{ color: 'var(--muted)', marginTop: 16 }}>Карьерный консультант — в разработке.</p>
    </main>
  );
}
