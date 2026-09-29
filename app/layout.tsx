import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DealWatch",
  description: "See what needs you, what is true, and what the paper and the emails disagree about.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f9f9f8]">{children}</body>
    </html>
  );
}
