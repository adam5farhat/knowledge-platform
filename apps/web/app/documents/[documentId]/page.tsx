import DocumentDetailClient from "./DocumentDetailClient";

export default async function DocumentDetailPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  return <DocumentDetailClient documentId={documentId} />;
}
