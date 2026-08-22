import { AppHeader } from '../components/AppHeader'
import { useSession } from '../lib/session'
import styles from './HomePage.module.css'

// Placeholder — the real Home screen (mockup 1b: new game / join game) is the
// next screen to be built. This exists so sign-in lands somewhere and the
// profile rename flow in the header is usable.
export function HomePage() {
  const { session } = useSession()

  return (
    <>
      <AppHeader />
      <main className={styles.main}>
        <h2 className={styles.title}>Game on, {session?.player.name}.</h2>
        <p className={styles.subtitle}>Pick your poison. (Home screen coming soon.)</p>
      </main>
    </>
  )
}
