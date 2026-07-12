import type { ReactNode } from "react";

export const metadata = { title: "FFXIV Defense Solver" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", margin: "2rem" }}>{children}</body>
    </html>
  );
}
