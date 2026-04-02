/**
 * Verifies a Checkout Session after redirect: payment status + metadata match (playbook share id, user id).
 * Client uses `authorized: true` to unlock import on `/playbook/[id]?success=true&session_id=...`.
 */
import { NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return NextResponse.json(
        { error: "Missing STRIPE_SECRET_KEY." },
        { status: 500 }
      );
    }

    const stripe = new Stripe(stripeSecretKey);

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body?.sessionId ?? "");
    const playbookShareId = String(body?.playbookId ?? "");
    const userId = String(body?.userId ?? "");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing sessionId." },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: [],
    });

    const paymentConfirmed =
      session.payment_status === "paid" || session.status === "complete";

    const meta = (session.metadata ?? {}) as Record<string, string | undefined>;

    const playbookMatches =
      !playbookShareId || meta.playbook_share_id === playbookShareId;
    const userMatches =
      !userId || meta.user_id === userId;

    return NextResponse.json({
      authorized: paymentConfirmed && playbookMatches && userMatches,
      payment_status: session.payment_status,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to verify checkout session." },
      { status: 500 }
    );
  }
}

