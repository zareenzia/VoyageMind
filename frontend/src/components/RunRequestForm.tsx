import { useState } from "react";

interface Props {
  onSubmit: (request: string) => void;
}

export function RunRequestForm({ onSubmit }: Props) {
  const [request, setRequest] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = request.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <input
        type="text"
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        placeholder="4 days in Meghalaya, BDT 45,000"
        className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        autoFocus
      />
      <button
        type="submit"
        disabled={!request.trim()}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Plan Trip
      </button>
    </form>
  );
}
