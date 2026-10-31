import Link from "next/link";
import styles from "../page.module.css";

export default function About() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1>About this site</h1>
          <p>A second page, reached through the App Router.</p>
        </div>
        <div className={styles.ctas}>
          <Link className={styles.secondary} href="/">
            Back home
          </Link>
        </div>
      </main>
    </div>
  );
}
