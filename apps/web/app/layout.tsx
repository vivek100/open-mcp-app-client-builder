import type { Metadata } from "next";

import { DynamicCopilotKitProvider } from "./components/CopilotKitProvider";
import "./globals.css";
import "@copilotkit/react-ui/v2/styles.css";

export const metadata: Metadata = {
  title: "MCP App builder",
  description: "Build, edit, and test MCP tool widgets in a live sandbox.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={"antialiased"}>
        <DynamicCopilotKitProvider>
          {children}
        </DynamicCopilotKitProvider>
      </body>
    </html>
  );
}
