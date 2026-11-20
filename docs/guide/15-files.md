# Map files, backups and maintenance

Audience is marked per section.

## Map artwork on this computer

Audience: GM and player. Required: a map package with downloadable artwork.

1. Open Configure Settings > KG Realms > Manage map files, or press Ctrl+Shift+M.
2. Check the selected world's map package and required disk space.
3. If folder access is supported, choose a local folder.
4. Start the download.
5. Keep the window open to inspect progress, speed and remaining files.


Each client chooses its own artwork storage. Saving the map on the GM's computer does not save it on players' computers.

## Pause, reconnect or repair

- Pause stops the download after current transfers settle; completed files remain.
- Reconnect restores browser access to a previously chosen folder when permission is needed.
- Verify/repair checks and downloads missing or damaged artwork through the available manager controls.
- Streaming uses server artwork without selecting a local folder.

If folder access is unavailable in the browser, use streaming. Local artwork storage does not replace the Foundry server or copy world edits to the player's computer.

## Back up a custom realm

Audience: GM.

Back up both:

1. The Foundry game world's data, containing place edits, routes, links and journey state.
2. `Data/KG Realms Data/World/`, containing generated custom-realm files.

Also retain original images and any files referenced by cards or scenes. A place-only export does not contain the whole world.

## Regenerate tiles

Audience: GM. Required: a converted custom realm and its source picture.

1. Open Configure Scene for the converted realm.
2. Choose the source picture in Background Image.
3. Click Regenerate map tiles from this picture in the scene configuration.
4. Review and confirm the build.
5. Wait for completion. The module reloads connected clients when the replacement tiles are ready.
6. Check the resulting scene and scale.

Changing Regional placement does not require tile regeneration.

## Revert the scene

Audience: GM.

1. Right-click the converted scene in the Scenes sidebar.
2. Choose Revert to backup.
3. Review the confirmation.
4. Confirm to restore the original picture/grid configuration.

The saved realm files remain. This action is not a rollback of all later world edits or elapsed game time.

## Export a companion module

Audience: GM.

1. Right-click a realm scene, either converted from an image or supplied by a companion module.
2. Choose Export as module.
3. Review the export options and create the ZIP.
4. Keep the ZIP as a versioned copy.
5. Install and test it in a separate game world before relying on it.

The export includes linked Regional scenes, local maps, interiors, their artwork, map data and saved placement. Packaged scenes remain included when re-exporting before generating them. Missing required files block the export and appear in a repair report.

In the destination game world, select maps from the hierarchy checklist. Reopen it through Generate in the Scenes sidebar. Unselected maps can also be generated from their linked place cards. Existing scenes keep their edits. Regional links are restored as their scenes are generated.

For local map background and placed tile rebuilding, see [Rebuild local map tiles](11-local-gm.md#rebuild-local-map-tiles).

## Updates

Audience: GM.

1. Back up the game world and generated realm files.
2. Record the engine and companion module versions.
3. Apply the chosen updates through Foundry Setup.
4. Reload the game world.
5. Check one realm, the party token, local links and any active journey before play.

See [Troubleshooting](16-troubleshooting.md). [Contents](README.md).
