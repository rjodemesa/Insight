import { notFound } from "next/navigation";
import { Suspense } from "react";
import ProductDetail from "@/components/insights/ProductDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return (
    <Suspense>
      <ProductDetail id={id} />
    </Suspense>
  );
}
