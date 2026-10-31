import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1>Launch day is Friday</h1>
          <p>
            A static export: every route is an HTML file in <code className={styles.code}>out/</code>,
            and the router moves between them without a reload.
          </p>
        </div>
        <div className={styles.ctas}>
          <Link className={styles.primary} href="/about">
            About this site
          </Link>
        </div>
      </main>
    </div>
  );
}
