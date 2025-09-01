---
title: "Your First Goose Experience Is On Us"
description: New Goose users receive $10 in Tetrate Agent Router credits for instant access to multiple models including GPT-5 and Sonnet-4.
authors: 
    - mic
    - rizel
---

![](tetrate-header.png)

 You shouldn’t need a credit card to vibe code with Goose. While Goose is completely free to use, the reality is that most performant LLMs aren't. You want to experience Goose in action without breaking the bank or jumping through hoops. We've been thinking about how to make that first step easier for newcomers to Goose.

That's why we're thrilled about our newest provider integration: [Tetrate's Agent Router Service](https://router.tetrate.ai). From August 27th through October 2nd, new Goose users can get $10 in credits to use Goose with any model on the Tetrate platform.

<!--truncate-->

We've upgraded the onboarding flow. Tetrate Agent Router now appears as a [recommended setup option](/docs/getting-started/installation#set-llm-provider) for new users. Selecting Tetrate takes you through OAuth account creation, then drops you back into Goose with your $10 credits ready to go.

![fresh install](welcome.png)


This integration gives Goose users:
* **Instant access** to models without manual setup
* **$10 in credits** to start building without a paywall
* **A unified model layer** powered by Tetrate
* **Stable routing** built on [Envoy](https://www.envoyproxy.io/), an open source proxy for high-scale systems


## Tetrate's Agent Router Service

Tetrate's Agent Router Service provides unified access to a comprehensive collection of AI models including open source options to cutting-edge frontier models like GPT-5, Sonnet-4, and Grok-4.

### From Cloud Infrastructure to AI Model Routing

Tetrate brings years of expertise in routing and infrastructure to the AI space. As major contributors to open source projects like Istio and Envoy, they understand how to build reliable, scalable routing systems. Now they're applying this same expertise to LLM traffic management.

LLM requests are inherently stateless, making them ideal for intelligent routing across multiple providers and models. This allows you to optimize for cost, speed, availability, or quality, or even use multiple models to cross-check results. Terminology in this space is still settling. Goose refers to Tetrate as a “provider” for consistency, though under the hood it is a router service that connects to other providers. That layer abstracts away model selection, auth, and host config, keeping your setup clean.

## Why This Collaboration Matters

Our goal is simple: make Goose accessible to everyone, immediately. That means removing barriers to getting started. Tetrate's generous credit offering and seamless integration help us achieve exactly that.

It also reflects Tetrate's ongoing commitment to open source and making AI development more accessible to developers worldwide.

## Explore the Full Model Catalog

While Goose auto-configures with Sonnet-4 by default, you have access to Tetrate's entire model catalog through the interface:

![providers](providers.png)
![gpt5](gpt5.png)

Browse and select from a wide range of options, including:
- **Open-weight models** (like Kimi/K2) hosted and ready to use
- **Frontier models** from various providers
- **Specialized models** optimized for different use cases

:::tip Protip 
 Want the best of both worlds? Use Goose’s [Lead/Worker configuration](/docs/tutorials/lead-worker) to combine a powerful frontier model with a faster open-weight model. Let your Lead handle the high-level thinking while Workers take care of the repetitive tasks—saving you both time and credits.
:::

---

Thank you to Tetrate for supporting open source and making AI development more accessible!

**What are you waiting for?** [Get started with Goose](/)

*Got questions?* Explore our [docs](/docs/category/guides), browse the [blog](/blog), or join the conversation in our [Discord](https://discord.gg/block-opensource) and [GitHub Discussions](https://github.com/block/goose/discussions). We’d love to have you.

<head>
  <meta property="og:title" content="Your First Goose Experience Is On Us" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://block.github.io/goose/blog/2025/08/27/get-started-for-free-with-tetrate" />
  <meta property="og:description" content="New Goose users receive $10 in Tetrate Agent Router credits for instant access to multiple models including GPT-5 and Sonnet-4." />
  <meta property="og:image" content="https://block.github.io/goose/assets/images/tetrate-header-9e2afbf5d1ce961d5f25547a7439c65f.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta property="twitter:domain" content="block.github.io/goose" />
  <meta name="twitter:title" content="Your First Goose Experience Is On Us" />
  <meta name="twitter:description" content="New Goose users receive $10 in Tetrate Agent Router credits for instant access to multiple models including GPT-5 and Sonnet-4" />
  <meta name="twitter:image" content="https://block.github.io/goose/assets/images/tetrate-header-9e2afbf5d1ce961d5f25547a7439c65f.png" />
</head>