import type { PlayerRenderState } from './RollbackPhysicsGame';

const PIP_DISPLAY_THRESHOLD = 4;

function formatPlayerLabel(playerId: string, localPlayerId: string): string {
  if (playerId === localPlayerId) {
    return 'You';
  }
  if (playerId.length <= 10) {
    return playerId;
  }
  return `${playerId.slice(0, 10)}…`;
}

function colorToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class StockHud {
  private readonly element: HTMLElement;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'stock-hud';
    this.element.dataset.visible = 'false';
    parent.appendChild(this.element);
  }

  setVisible(visible: boolean): void {
    this.element.dataset.visible = visible ? 'true' : 'false';
  }

  update(players: readonly PlayerRenderState[], localPlayerId: string): void {
    if (players.length === 0) {
      this.element.innerHTML =
        '<p class="stock-hud-empty">Stocks appear when players join the match.</p>';
      return;
    }

    const sorted = [...players].sort((left, right) => {
      if (left.id === localPlayerId) {
        return -1;
      }
      if (right.id === localPlayerId) {
        return 1;
      }
      return left.id.localeCompare(right.id);
    });

    this.element.innerHTML = sorted
      .map((player) => this.renderPlayerCard(player, localPlayerId))
      .join('');
  }

  destroy(): void {
    this.element.remove();
  }

  private renderPlayerCard(
    player: PlayerRenderState,
    localPlayerId: string,
  ): string {
    const isLocal = player.id === localPlayerId;
    const label = formatPlayerLabel(player.id, localPlayerId);
    const stocks = Math.max(0, player.stocks);
    let pips: string;
    if (stocks <= PIP_DISPLAY_THRESHOLD) {
      pips = Array.from({ length: stocks }, () =>
        `<span class="stock-pip stock-pip--filled" aria-hidden="true"></span>`,
      ).join('');
    } else {
      pips = `<span class="stock-count">${stocks}×</span>`;
    }

    let status = '';
    if (player.eliminated) {
      status = 'Out';
    } else if (player.respawning) {
      status = 'Respawning';
    }

    return `
      <article
        class="stock-card${isLocal ? ' stock-card--local' : ''}"
        data-eliminated="${player.eliminated ? 'true' : 'false'}"
        data-respawning="${player.respawning ? 'true' : 'false'}"
      >
        <div class="stock-card-header">
          <span class="stock-card-swatch" style="background:${colorToCss(player.color)}"></span>
          <span class="stock-card-name">${label}</span>
          ${status ? `<span class="stock-card-status">${status}</span>` : ''}
        </div>
        <div class="stock-pips" aria-label="${player.stocks} stocks remaining">
          ${pips}
        </div>
      </article>
    `;
  }
}
