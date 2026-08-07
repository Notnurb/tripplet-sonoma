import { redirect } from 'next/navigation';

// The Code workspace is the OpenCode web UI, which manages its own session
// URLs. Tripplet conversation ids no longer map to code routes, so fold any
// legacy /code/[id] deep link into the workspace index.
export default function CodeIdPage() {
    redirect('/code');
}
