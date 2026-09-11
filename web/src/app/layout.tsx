import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Geobyte Lab",
  description: "Geoscience and computation research laboratory.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
