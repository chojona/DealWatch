import { Skeleton } from "@/components/ui/skeleton";

export default function DealLoading() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-line bg-surface">
        <div className="page-gutter py-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-8 w-2/3 max-w-md" />
          <Skeleton className="mt-4 h-4 w-64" />
        </div>
      </div>
      <main className="page-frame space-y-10">
        <div>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-4 h-16 w-full" />
        </div>
        <div>
          <Skeleton className="h-6 w-40" />
          <div className="mt-5 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </div>
      </main>
    </div>
  );
}
