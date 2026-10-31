import { Link } from 'react-router'

function About() {
  return (
    <section id="center">
      <div>
        <h1>About this app</h1>
        <p>
          A second route, loaded on demand, so the app has a client-side
          router and a split chunk.
        </p>
      </div>
      <Link to="/" className="counter">
        Back home
      </Link>
    </section>
  )
}

export default About
