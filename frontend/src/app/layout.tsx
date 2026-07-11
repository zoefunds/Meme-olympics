import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/Nav";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Meme Olympics — AI-Judged Glory",
  description:
    "Weekly crypto meme competitions judged by GenLayer validator consensus. No likes. No votes. Only logic.",
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 20c-3 10 0 24 10 32M50 20c3 10 0 24-10 32" stroke="#ffd700" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M32 10c5 6 8 10 8 15a8 8 0 11-16 0c0-5 3-9 8-15z" fill="#7701d0"/><path d="M32 18c2.5 3 4 5.5 4 8a4 4 0 11-8 0c0-2.5 1.5-5 4-8z" fill="#00f1fe"/><rect x="26" y="38" width="12" height="6" rx="1" fill="#ffd700"/><rect x="23" y="46" width="18" height="5" rx="1" fill="#e9c400" opacity="0.8"/></svg>`
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${grotesk.variable} ${inter.variable} ${jetbrains.variable} font-body corner-glows min-h-screen`}
      >
        <TopNav />
        <div className="pt-20 pb-20 md:pb-8">{children}</div>
      </body>
    </html>
  );
}
