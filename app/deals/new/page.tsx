import Link from "next/link";
import { Nav } from "@/components/nav";
import { CreateDealForm } from "@/components/deals/create-deal-form";

export const dynamic = "force-dynamic";

export default function NewDealPage() {
  return (
    <div className="min-h-screen">
      <Nav active="/deals" />
      <main className="mx-auto max-w-xl px-6 py-6">
        <p className="text-xs text-zinc-400">
          <Link href="/deals" className="hover:text-zinc-600">Deals</Link>
          <span> / </span>
          <span className="text-zinc-600">New deal</span>
        </p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-900">Create deal</h1>
        <p className="mt-1 mb-6 text-xs text-zinc-500">
          A name is enough. You can add documents and messages from the deal workspace.
        </p>
        <CreateDealForm />
      </main>
    </div>
  );
}
