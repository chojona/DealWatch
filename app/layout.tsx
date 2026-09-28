import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DealWatch — CRE Transaction Intelligence",
  description:
    "Reconstruct CRE negotiations, track term movement, and surface unresolved issues.",
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
