import { NextResponse } from 'next/server';
import { getNewsletterData, getNewsletterMarkdown } from '@/lib/data';

export async function GET(
  request: Request,
  { params }: { params: { period: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';

    if (format === 'markdown') {
      const markdown = await getNewsletterMarkdown(params.period);

      if (!markdown) {
        return NextResponse.json(
          { error: 'Newsletter not found' },
          { status: 404 }
        );
      }

      return new NextResponse(markdown, {
        headers: {
          'Content-Type': 'text/markdown',
        },
      });
    }

    const newsletter = await getNewsletterData(params.period);

    return NextResponse.json({
      data: newsletter,
      meta: {
        period: params.period,
        generated_at: newsletter.generated_at,
        story_count: newsletter.stories?.length || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching newsletter:', error);
    return NextResponse.json(
      { error: 'Failed to fetch newsletter' },
      { status: 500 }
    );
  }
}
