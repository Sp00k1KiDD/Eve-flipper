package graph

// SystemsWithinRadius returns all systems reachable from origin within maxJumps,
// mapped to their distance in jumps.
func (u *Universe) SystemsWithinRadius(origin int32, maxJumps int) map[int32]int {
	return u.SystemsWithinRadiusMinSecurity(origin, maxJumps, 0)
}

// SystemsWithinRadiusMinSecurity returns systems reachable within maxJumps where
// every system on the path has security >= minSecurity. Use minSecurity <= 0 for no filter.
func (u *Universe) SystemsWithinRadiusMinSecurity(origin int32, maxJumps int, minSecurity float64) map[int32]int {
	result := make(map[int32]int)
	result[origin] = 0

	queue := []int32{origin}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		dist := result[current]
		if dist >= maxJumps {
			continue
		}
		for _, neighbor := range u.Adj[current] {
			if minSecurity > 0 {
				if sec, ok := u.SystemSecurity[neighbor]; !ok || sec < minSecurity {
					continue
				}
			}
			if _, visited := result[neighbor]; !visited {
				result[neighbor] = dist + 1
				queue = append(queue, neighbor)
			}
		}
	}
	return result
}

// ShortestPath returns the shortest jump count between origin and dest using BFS.
// All edges have unit weight (1 jump), so BFS is optimal.
// Returns -1 if no path exists.
func (u *Universe) ShortestPath(origin, dest int32) int {
	return u.ShortestPathMinSecurity(origin, dest, 0)
}

// ShortestPathMinSecurity returns the shortest jump count using only systems with
// security >= minSecurity. Uses BFS (all edges are unit weight).
// Use minSecurity <= 0 for no filter. Returns -1 if no path exists.
func (u *Universe) ShortestPathMinSecurity(origin, dest int32, minSecurity float64) int {
	if origin == dest {
		return 0
	}
	if minSecurity > 0 {
		if sec, ok := u.SystemSecurity[origin]; ok && sec < minSecurity {
			return -1
		}
		if sec, ok := u.SystemSecurity[dest]; ok && sec < minSecurity {
			return -1
		}
	}

	dist := make(map[int32]int)
	dist[origin] = 0

	queue := []int32{origin}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		currentDist := dist[current]

		for _, neighbor := range u.Adj[current] {
			if minSecurity > 0 {
				if sec, ok := u.SystemSecurity[neighbor]; !ok || sec < minSecurity {
					continue
				}
			}
			if _, visited := dist[neighbor]; !visited {
				nd := currentDist + 1
				if neighbor == dest {
					return nd
				}
				dist[neighbor] = nd
				queue = append(queue, neighbor)
			}
		}
	}
	return -1
}

// RegionsInSet returns the unique region IDs for a set of systems.
func (u *Universe) RegionsInSet(systems map[int32]int) map[int32]bool {
	regions := make(map[int32]bool)
	for sysID := range systems {
		if r, ok := u.SystemRegion[sysID]; ok {
			regions[r] = true
		}
	}
	return regions
}

// SystemsInRegions returns all system IDs that belong to any of the given regions.
// Used for multi-region arbitrage: consider all systems in the region, not just within jump radius.
func (u *Universe) SystemsInRegions(regions map[int32]bool) map[int32]int {
	out := make(map[int32]int)
	for sysID, regionID := range u.SystemRegion {
		if regions[regionID] {
			out[sysID] = 0
		}
	}
	return out
}
