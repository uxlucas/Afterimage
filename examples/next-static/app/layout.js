import "./globals.css";

export const metadata = {
  title: "Next static export",
  description: "An Afterimage example",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
