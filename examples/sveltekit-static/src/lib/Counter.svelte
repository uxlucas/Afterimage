<script>
	let count = $state(0);
</script>

<button onclick={() => (count += 1)}>Count is {count}</button>

<style>
	button {
		padding: 0.5rem 1rem;
		border: 1px solid #d4d4d8;
		border-radius: 0.5rem;
		background: #fafafa;
		font: inherit;
	}
</style>
