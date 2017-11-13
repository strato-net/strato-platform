import { createSelector } from 'reselect'

const getContent = (state) => {
	const content = state.tab[state.currentTabSelected]
	return content
}

export const getSelectedTabContent = createSelector(getContent, (content) => content)