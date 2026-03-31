import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabaseClient";

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
    const playbookShareId = String(body?.playbookId ?? body?.id ?? "");
    const userId = String(body?.userId ?? "");
    if (!playbookShareId) {
      return NextResponse.json(
        { error: "Missing playbookId." },
        { status: 400 }
      );
    }

    // Fetch playbook details to build the line item.
    const { data: folder, error: folderErr } = await supabase
      .from("folders")
      .select("id, name, price")
      .eq("share_id", playbookShareId)
      .single();

    if (folderErr || !folder) {
      return NextResponse.json(
        { error: folderErr?.message ?? "Playbook not found." },
        { status: 404 }
      );
    }

    const unitAmountCents = Math.round((folder.price ?? 19) * 100);

    if (!Number.isFinite(unitAmountCents) || unitAmountCents <= 0) {
      return NextResponse.json(
        { error: "Invalid playbook price." },
        { status: 400 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const successUrl = `${baseUrl}/playbook/${encodeURIComponent(
      playbookShareId
    )}?success=true&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/playbook/${encodeURIComponent(playbookShareId)}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: unitAmountCents,
            product_data: {
              name: String(folder.name ?? "Playbook"),
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        playbook_share_id: playbookShareId,
        playbook_folder_id: String(folder.id ?? ""),
        user_id: userId,
      },
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to create checkout session." },
      { status: 500 }
    );
  }
}

