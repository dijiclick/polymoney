export default function TraderProfileSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Header skeleton */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <div className="h-9 bg-gray-700 rounded w-48 mb-3" />
          <div className="flex items-center gap-4">
            <div className="h-4 bg-gray-700 rounded w-96" />
            <div className="h-4 bg-gray-700 rounded w-32" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-7 bg-gray-700 rounded-full w-24" />
        </div>
      </div>

      {/* Main Stats Grid skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-4">
            <div className="h-4 bg-gray-700 rounded w-24 mb-3" />
            <div className="h-8 bg-gray-700 rounded w-20" />
          </div>
        ))}
      </div>

      {/* Classification Scores skeleton */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <div className="h-6 bg-gray-700 rounded w-48 mb-6" />
        <div className="grid grid-cols-2 gap-6">
          {[...Array(2)].map((_, i) => (
            <div key={i}>
              <div className="flex justify-between mb-2">
                <div className="h-4 bg-gray-700 rounded w-32" />
                <div className="h-4 bg-gray-700 rounded w-16" />
              </div>
              <div className="h-3 bg-gray-700 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Stats skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-6">
            <div className="h-5 bg-gray-700 rounded w-36 mb-6" />
            <div className="space-y-4">
              {[...Array(5)].map((_, j) => (
                <div key={j} className="flex justify-between">
                  <div className="h-4 bg-gray-700 rounded w-28" />
                  <div className="h-4 bg-gray-700 rounded w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Positions table skeleton */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="h-5 bg-gray-700 rounded w-40 mb-6" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    </div>
  )
}
