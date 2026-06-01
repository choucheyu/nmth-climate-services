"use client";

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Upload,
  Typography,
} from "antd";
import type { UploadProps } from "antd";
import { useQuery } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiUrl, csrfHeaders } from "../lib/api";
import { useResponsiveMode } from "../lib/responsive";

const MAX_PDF_UPLOAD_BYTES = 25 * 1024 * 1024;

export function PdfFloorPlanUploader({
  onUploaded,
  exhibitionId,
  disabled = false,
}: {
  onUploaded?: () => Promise<unknown> | unknown;
  exhibitionId?: string;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const { message } = App.useApp();
  const { isMobile } = useResponsiveMode();
  const [form] = Form.useForm();
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [floorPlanId, setFloorPlanId] = useState<string>();
  const [uploadPageNumber, setUploadPageNumber] = useState(1);
  const [uploadRenderScale, setUploadRenderScale] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const floorPlans = useQuery({
    queryKey: ["floor-plans", "upload-select", exhibitionId],
    queryFn: () =>
      apiFetch<any[]>(
        `/floor-plans${exhibitionId ? `?exhibitionId=${exhibitionId}` : ""}`,
      ),
    retry: 1,
    enabled: !disabled,
  });
  const exhibitions = useQuery({
    queryKey: ["exhibitions", "floor-plan-create"],
    queryFn: () => apiFetch<any>("/exhibitions?page=1&pageSize=100"),
    retry: 1,
    enabled: !exhibitionId && !disabled,
  });

  useEffect(() => {
    if (!floorPlans.data?.length) {
      setFloorPlanId(undefined);
      return;
    }
    if (
      !floorPlanId ||
      !floorPlans.data.some((item) => item.id === floorPlanId)
    ) {
      setFloorPlanId(floorPlans.data[0]?.id);
    }
  }, [floorPlanId, floorPlans.data]);

  const beforeUpload = useCallback<NonNullable<UploadProps["beforeUpload"]>>(
    async (file) => {
      const targetFloorPlanId = floorPlanId;
      if (!targetFloorPlanId) {
        message.error(t("floorPlan.selectFloorPlanFirst"));
        return false;
      }
      if (file.size > MAX_PDF_UPLOAD_BYTES) {
        message.error(t("report.exportFailed"));
        return false;
      }
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url,
      ).toString();
      const data = await file.arrayBuffer();
      if (new TextDecoder().decode(data.slice(0, 5)) !== "%PDF-") {
        message.error(t("report.exportFailed"));
        return false;
      }
      const doc = await pdfjs.getDocument({ data }).promise;
      setPageCount(doc.numPages);
      const safePageNumber = Math.max(
        1,
        Math.min(uploadPageNumber, doc.numPages),
      );
      const page = await doc.getPage(safePageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const formData = new FormData();
      formData.append("file", file);
      formData.append("pageNumber", String(safePageNumber));
      formData.append("width", String(Math.round(viewport.width)));
      formData.append("height", String(Math.round(viewport.height)));
      formData.append("renderScale", String(uploadRenderScale));
      try {
        await fetch(apiUrl(`/floor-plans/${targetFloorPlanId}/versions`), {
          method: "POST",
          credentials: "include",
          headers: csrfHeaders(),
          body: formData,
        }).then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
        });
      } finally {
        await doc.destroy();
      }
      message.success(t("floorPlan.uploadPdf"));
      await floorPlans.refetch();
      await onUploaded?.();
      return false;
    },
    [
      floorPlanId,
      floorPlans,
      message,
      onUploaded,
      t,
      uploadPageNumber,
      uploadRenderScale,
    ],
  );

  async function createFloorPlan(values: {
    exhibitionId?: string;
    name: string;
  }) {
    const targetExhibitionId = exhibitionId ?? values.exhibitionId;
    if (!targetExhibitionId) {
      message.error(t("exhibition.selectExhibition"));
      return;
    }
    const created = await apiFetch<any>("/floor-plans", {
      method: "POST",
      body: JSON.stringify({
        exhibitionId: targetExhibitionId,
        name: values.name,
      }),
    });
    setFloorPlanId(created.id);
    setCreateOpen(false);
    form.resetFields();
    await floorPlans.refetch();
    await onUploaded?.();
  }

  return (
    <>
      <Space wrap direction={isMobile ? "vertical" : "horizontal"} style={isMobile ? { width: "100%" } : undefined}>
        <Select
          placeholder={t("floorPlan.selectOrCreateFloorPlan")}
          value={floorPlanId}
          onChange={setFloorPlanId}
          disabled={disabled}
          loading={floorPlans.isLoading}
          options={(floorPlans.data ?? []).map((item) => ({
            value: item.id,
            label: exhibitionId
              ? item.name
              : `${item.exhibition?.name ?? "-"} / ${item.name}`,
          }))}
          style={{ minWidth: isMobile ? 0 : 240, width: isMobile ? "100%" : undefined }}
        />
        <InputNumber
          min={1}
          value={uploadPageNumber}
          onChange={(value) => setUploadPageNumber(Number(value ?? 1))}
          addonBefore={t("floorPlan.page")}
          style={isMobile ? { width: "100%" } : undefined}
        />
        <Select
          value={uploadRenderScale}
          onChange={setUploadRenderScale}
          options={[
            { value: 1, label: t("floorPlan.renderScaleStandard") },
            { value: 2, label: t("floorPlan.renderScaleHigh") },
          ]}
          style={isMobile ? { width: "100%" } : undefined}
        />
        <Button block={isMobile} disabled={disabled} onClick={() => setCreateOpen(true)}>
          {t("floorPlan.createFloorPlan")}
        </Button>
        <Upload
          accept="application/pdf"
          beforeUpload={beforeUpload}
          maxCount={1}
          showUploadList={false}
        >
          <Button
            block={isMobile}
            disabled={disabled || !floorPlanId}
            icon={<FileUp size={16} />}
          >
            {t("floorPlan.uploadPdf")}
          </Button>
          {pageCount ? (
            <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
              {t("floorPlan.page")}: {pageCount}
            </Typography.Text>
          ) : null}
        </Upload>
      </Space>
      <Modal
        title={t("floorPlan.createFloorPlan")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        width={isMobile ? "calc(100vw - 32px)" : undefined}
      >
        <Form form={form} layout="vertical" onFinish={createFloorPlan}>
          {!exhibitionId ? (
            <Form.Item
              name="exhibitionId"
              label={t("exhibition.name")}
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={exhibitions.isLoading}
                options={(exhibitions.data?.items ?? []).map((item: any) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            </Form.Item>
          ) : null}
          <Form.Item
            name="name"
            label={t("exhibition.floorPlans")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
