"use client";

import { Button, Card, Form, Input, Typography, App } from "antd";
import { LockKeyhole, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../lib/api";

export default function LoginPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { message } = App.useApp();

  async function onFinish(values: { email: string; password: string }) {
    try {
      await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(values) });
      router.push(`/${locale}/dashboard`);
    } catch {
      message.error(t("auth.loginFailed"));
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(180deg, #F4F9FD 0%, #EBF3F5 100%)"
      }}
    >
      <Card className="nmth-panel" style={{ width: "min(100%, 430px)" }} styles={{ body: { padding: 32 } }}>
        <div className="nmth-brand" style={{ marginBottom: 28 }}>
          <div className="nmth-brand-mark">N</div>
          <div>
            <div className="nmth-brand-title">{t("app.brand")}</div>
            <div className="nmth-brand-subtitle">{t("app.subtitle")}</div>
          </div>
        </div>
        <Typography.Title level={2} style={{ marginTop: 0 }}>
          {t("auth.login")}
        </Typography.Title>
        <Form layout="vertical" onFinish={onFinish} requiredMark>
          <Form.Item name="email" label={t("auth.email")} rules={[{ required: true, message: t("auth.required") }]}>
            <Input prefix={<Mail size={16} />} type="email" autoComplete="email" />
          </Form.Item>
          <Form.Item name="password" label={t("auth.password")} rules={[{ required: true, message: t("auth.required") }]}>
            <Input.Password prefix={<LockKeyhole size={16} />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t("auth.login")}
          </Button>
        </Form>
      </Card>
    </main>
  );
}
