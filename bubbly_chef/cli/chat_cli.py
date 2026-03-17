#!/usr/bin/env python3
"""
Interactive CLI for testing the BubblyChef chat workflow.

Usage:
    python -m bubbly_chef.cli.chat_cli

Or with uvx/pipx:
    uvx --from . bubbly-chat

This provides a terminal-based chat experience to test the
AI-powered pantry management features.
"""

import asyncio
from typing import Any

# Rich for nice terminal output (optional, fallback to plain text)
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.syntax import Syntax
    from rich.table import Table

    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False


class SimplePrinter:
    """Fallback printer when Rich is not available."""

    def print(self, *args, **kwargs):
        # Filter out rich-specific kwargs
        kwargs.pop("style", None)
        print(*args)

    def rule(self, text=""):
        print(f"\n{'=' * 50}")
        if text:
            print(f"  {text}")
        print("=" * 50)


console = Console() if RICH_AVAILABLE else SimplePrinter()


def print_welcome():
    """Print welcome message."""
    if RICH_AVAILABLE:
        console.print(
            Panel.fit(
                "[bold green]BubblyChef Chat[/bold green]\n"
                "[dim]AI-powered pantry management assistant[/dim]\n\n"
                "Commands:\n"
                "  [cyan]exit[/cyan] or [cyan]quit[/cyan] - Exit the chat\n"
                "  [cyan]help[/cyan] - Show this help\n"
                "  [cyan]clear[/cyan] - Clear screen\n"
                "  [cyan]debug[/cyan] - Toggle debug mode\n"
                "  [cyan]json[/cyan] - Show last response as JSON\n\n"
                "Try saying:\n"
                "  [green]I bought milk and eggs[/green]\n"
                "  [green]I scanned a receipt[/green]\n"
                "  [green]How long does cheese last?[/green]",
                title="Welcome",
                border_style="blue",
            )
        )
    else:
        console.rule("BubblyChef Chat")
        print("AI-powered pantry management assistant")
        print("\nCommands: exit/quit, help, clear, debug, json")
        print("\nTry: 'I bought milk and eggs'")
        console.rule()


def print_response(envelope: Any, debug: bool = False):
    """Print the response envelope in a nice format."""
    if RICH_AVAILABLE:
        # Create intent badge
        intent_colors = {
            "pantry_update": "green",
            "receipt_ingest_request": "yellow",
            "product_ingest_request": "yellow",
            "recipe_ingest_request": "yellow",
            "general_chat": "blue",
        }
        intent_str = (
            envelope.intent.value if hasattr(envelope.intent, "value") else str(envelope.intent)
        )
        intent_color = intent_colors.get(intent_str, "white")

        # Main message panel
        console.print()
        console.print(
            Panel(
                f"[bold]{envelope.assistant_message}[/bold]",
                title=f"[{intent_color}]🤖 BubblyChef[/{intent_color}]",
                subtitle=(
                    f"[dim]intent: {intent_str}"
                    f" | confidence: {envelope.confidence.overall:.0%}[/dim]"
                ),
                border_style=intent_color,
            )
        )

        # Show proposal if present
        if (
            envelope.proposal
            and hasattr(envelope.proposal, "actions")
            and envelope.proposal.actions
        ):
            table = Table(title="Proposed Actions", border_style="dim")
            table.add_column("Action", style="cyan")
            table.add_column("Item", style="green")
            table.add_column("Qty", justify="right")
            table.add_column("Unit")
            table.add_column("Conf", justify="right")

            for action in envelope.proposal.actions:
                conf_style = (
                    "green"
                    if action.confidence > 0.8
                    else "yellow"
                    if action.confidence > 0.6
                    else "red"
                )
                table.add_row(
                    action.action_type.value
                    if hasattr(action.action_type, "value")
                    else str(action.action_type),
                    action.item.name,
                    f"{action.item.quantity:.1f}",
                    action.item.unit,
                    f"[{conf_style}]{action.confidence:.0%}[/{conf_style}]",
                )

            console.print(table)

        # Show handoff proposal
        elif envelope.proposal and hasattr(envelope.proposal, "kind"):
            console.print(f"[yellow]📋 Next step: {envelope.proposal.instructions}[/yellow]")
            console.print(
                f"[dim]Required inputs: {', '.join(envelope.proposal.required_inputs)}[/dim]"
            )

        # Show next action hint
        next_action_str = (
            envelope.next_action.value
            if hasattr(envelope.next_action, "value")
            else str(envelope.next_action)
        )
        if next_action_str != "none":
            console.print(f"\n[dim]Next action: {next_action_str}[/dim]")

        # Show clarifying questions
        if envelope.clarifying_questions:
            for q in envelope.clarifying_questions:
                console.print(f"[yellow]❓ {q}[/yellow]")

        # Show warnings
        for warning in envelope.warnings:
            console.print(f"[yellow]⚠ {warning}[/yellow]")

        # Show errors
        for error in envelope.errors:
            console.print(f"[red]✖ {error}[/red]")

        # Debug info
        if debug:
            console.print()
            console.print("[dim]─── Debug Info ───[/dim]")
            console.print(f"[dim]request_id: {envelope.request_id}[/dim]")
            console.print(f"[dim]workflow_id: {envelope.workflow_id}[/dim]")
            console.print(f"[dim]requires_review: {envelope.requires_review}[/dim]")
    else:
        # Plain text output
        print()
        intent_str = (
            envelope.intent.value if hasattr(envelope.intent, "value") else str(envelope.intent)
        )
        print(f"[{intent_str}] {envelope.assistant_message}")
        print(f"Confidence: {envelope.confidence.overall:.0%}")

        if (
            envelope.proposal
            and hasattr(envelope.proposal, "actions")
            and envelope.proposal.actions
        ):
            print("\nProposed Actions:")
            for action in envelope.proposal.actions:
                action_type = (
                    action.action_type.value
                    if hasattr(action.action_type, "value")
                    else str(action.action_type)
                )
                print(
                    f"  - {action_type}: {action.item.quantity}"
                    f" {action.item.unit} {action.item.name}"
                )

        next_action_str = (
            envelope.next_action.value
            if hasattr(envelope.next_action, "value")
            else str(envelope.next_action)
        )
        if next_action_str != "none":
            print(f"Next action: {next_action_str}")

        for warning in envelope.warnings:
            print(f"Warning: {warning}")

        for error in envelope.errors:
            print(f"Error: {error}")


def print_json(envelope: Any):
    """Print envelope as formatted JSON."""
    try:
        json_str = envelope.model_dump_json(indent=2)
        if RICH_AVAILABLE:
            console.print(Syntax(json_str, "json", theme="monokai"))
        else:
            print(json_str)
    except Exception as e:
        print(f"Error serializing to JSON: {e}")


async def run_chat_loop():
    """Main chat loop."""
    from bubbly_chef.workflows.chat_ingest import run_chat_workflow

    debug_mode = False
    last_envelope = None
    conversation_id = None

    print_welcome()

    while True:
        try:
            # Get user input
            if RICH_AVAILABLE:
                console.print()
                user_input = console.input("[bold cyan]You:[/bold cyan] ").strip()
            else:
                user_input = input("\nYou: ").strip()

            if not user_input:
                continue

            # Handle commands
            cmd = user_input.lower()

            if cmd in ("exit", "quit", "q"):
                if RICH_AVAILABLE:
                    console.print("[dim]Goodbye! 👋[/dim]")
                else:
                    print("Goodbye!")
                break

            elif cmd == "help":
                print_welcome()
                continue

            elif cmd == "clear":
                console.clear() if RICH_AVAILABLE else print("\033[H\033[J")
                print_welcome()
                continue

            elif cmd == "debug":
                debug_mode = not debug_mode
                status = "enabled" if debug_mode else "disabled"
                if RICH_AVAILABLE:
                    console.print(f"[dim]Debug mode {status}[/dim]")
                else:
                    print(f"Debug mode {status}")
                continue

            elif cmd == "json":
                if last_envelope:
                    print_json(last_envelope)
                else:
                    print("No previous response to show")
                continue

            # Run chat workflow
            try:
                if RICH_AVAILABLE:
                    with console.status("[bold green]Thinking...", spinner="dots"):
                        envelope = await run_chat_workflow(
                            message=user_input,
                            conversation_id=conversation_id,
                            mode="text",
                        )
                else:
                    print("Processing...")
                    envelope = await run_chat_workflow(
                        message=user_input,
                        conversation_id=conversation_id,
                        mode="text",
                    )

                last_envelope = envelope
                print_response(envelope, debug=debug_mode)

                # Update conversation ID for multi-turn
                if envelope.conversation_id:
                    conversation_id = str(envelope.conversation_id)

            except Exception as e:
                if RICH_AVAILABLE:
                    console.print(f"[red]Error: {e}[/red]")
                else:
                    print(f"Error: {e}")

                if debug_mode:
                    import traceback

                    traceback.print_exc()

        except KeyboardInterrupt:
            if RICH_AVAILABLE:
                console.print("\n[dim]Use 'exit' to quit[/dim]")
            else:
                print("\nUse 'exit' to quit")
        except EOFError:
            break


def main():
    """Entry point for the CLI."""
    # Check for Ollama availability
    print("Checking Ollama connection...")

    try:
        import httpx

        response = httpx.get("http://localhost:11434/api/tags", timeout=5.0)
        if response.status_code != 200:
            print("Warning: Ollama may not be running. Chat features may fail.")
    except Exception:
        print("Warning: Could not connect to Ollama at localhost:11434")
        print("Make sure Ollama is running: ollama serve")
        print()

    # Run the async chat loop
    asyncio.run(run_chat_loop())


if __name__ == "__main__":
    main()
