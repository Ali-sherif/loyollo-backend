import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
  /**
   * ADR-022 §N requires the invitation email to state the shop, branch, role, and
   * expiry alongside the accept-link. It must never carry a password or any token
   * other than the one inside `confirmationUrl`.
   */
  shopName: string;
  branchName: string;
  role: string;
  expiresAt: string;
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
  shopName,
  branchName,
  role,
  expiresAt,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {shopName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join{" "}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Click the button below to accept the invitation and create your account.
        </Text>
        <Text style={details}>
          <strong>Shop:</strong> {shopName}
          <br />
          <strong>Branch:</strong> {branchName}
          <br />
          <strong>Role:</strong> {role}
          <br />
          <strong>Invitation expires:</strong> {expiresAt}
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept Invitation
        </Button>
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default InviteEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = {
  fontSize: "22px",
  fontWeight: "bold" as const,
  color: "#000000",
  margin: "0 0 20px",
};
const text = {
  fontSize: "14px",
  color: "#55575d",
  lineHeight: "1.5",
  margin: "0 0 25px",
};
const details = {
  fontSize: "14px",
  color: "#55575d",
  lineHeight: "1.8",
  margin: "0 0 25px",
};
const link = { color: "inherit", textDecoration: "underline" };
const button = {
  backgroundColor: "#000000",
  color: "#ffffff",
  fontSize: "14px",
  borderRadius: "8px",
  padding: "12px 20px",
  textDecoration: "none",
};
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0" };
