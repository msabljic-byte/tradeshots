"use client";

import { useParams } from "next/navigation";
import SharedPlaybookView from "@/components/playbook/SharedPlaybookView";

export default function PublicPlaybookPage() {
  const params = useParams<{ id: string }>();
  const shareId = String(params?.id ?? "");
  return <SharedPlaybookView shareId={shareId} />;
}

