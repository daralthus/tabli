'use strict';

import * as TabWindow from './tabWindow';
import * as utils from './utils';

/**
 * get all open Chrome windows and synchronize state with our tab window store
 *
 * cb -- if non-null, no-argument callback to call when complete
 *
 */
export function syncChromeWindows(winStore,cb) {
  var t_preGet = performance.now();
  chrome.windows.getAll( {populate: true}, function (windowList) {
      var t_postGet = performance.now();
      console.log("syncChromeWindows: chrome.windows.getAll took ", t_postGet - t_preGet, " ms");
      winStore.syncWindowList(windowList);
      if (cb)
        cb();
   });
}

/**
 * restore a bookmark window.
 *
 * N.B.: NOT exported; called from openWindow
 */
function restoreBookmarkWindow(winStore, tabWindow) {
  console.log("restoreBookmarkWindow: ", tabWindow);
  var self = this;
  /*
   * special case handling of replacing the contents of a fresh window 
   */    
  chrome.windows.getLastFocused( {populate: true }, function (currentChromeWindow) {
    const urls = tabWindow.tabItems.map((ti) => ti.url).toArray();
    function cf( chromeWindow ) {
      console.log("restoreBookmarkWindow: cf");
      winStore.attachChromeWindow(tabWindow,chromeWindow);
    }
    console.log( "current chrome window: ", currentChromeWindow );
    if ((currentChromeWindow.tabs.length===1) &&
        (currentChromeWindow.tabs[0].url==="chrome://newtab/")) {
      console.log("found new window -- replacing contents");
      var origTabId = currentChromeWindow.tabs[0].id;
      // new window -- replace contents with urls:
      for ( var i = 0; i < urls.length; i++ ) {
        // First use our existing tab:
        if (i==0) {
          chrome.tabs.update( origTabId, { url: urls[i] } );
        } else {
          const tabInfo = { windowId: currentChromeWindow.id, url: urls[ i ] };
          chrome.tabs.create(tabInfo);
        }
      }
    } else {
      // normal case -- create a new window for these urls:
      chrome.windows.create( { url: urls, focused: true, type: 'normal'}, cf );
    }
  });
}

export function openWindow(winStore,tabWindow) {
  var self = this;

  if (tabWindow.open) {
    // existing, open window -- just transfer focus
    chrome.windows.update( tabWindow.openWindowId, { focused: true });
    // TODO: update focus in winStore
  } else {
    // bookmarked window -- need to open it!
    restoreBookmarkWindow(winStore,tabWindow);      
  }    
}

// activate a specific tab:
export function activateTab(winStore,tabWindow,tab,tabIndex) {
  var self = this;
  console.log("activateTab: ", tabWindow, tab );
  if( tabWindow.open ) {
    // OK, so we know this window is open.  What about the specific tab?
    if (tab.open) { 
      // Tab is already open, just make it active:
      console.log("making tab active");
      chrome.tabs.update( tab.openTabId, { active: true }, function () {
        console.log("making tab's window active");
        chrome.windows.update( tabWindow.openWindowId, { focused: true });
      });
    } else {
      // restore this bookmarked tab:
      var createOpts = {
        windowId: tabWindow.openWindowId, 
        url: tab.url,
        index: tabIndex,
        active: true
      };
      console.log("restoring bookmarked tab")
      chrome.tabs.create( createOpts, callback );
    }
  } else {
    console.log("activateTab: opening non-open window");
    openWindow(tabWindow);
    // TODO: activate chosen tab after opening window!
  }        
}

export function closeTab(winStore,tabWindow,tabId) {
  console.log("closeTab: closing tab ",tabWindow.toJS(), tabId);;

  const openTabCount = tabWindow.openTabCount;
  chrome.tabs.remove(tabId,() => {
    console.log("closeTab: tab closed");
    if (openTabCount==1) {
      winStore.handleTabWindowClosed(tabWindow);      
    } else {
      console.log("closeTab: syncing window state")
      /*
       * We'd like to do a full chrome.windows.get here so that we get the currently active tab
       * but amazingly we still see the closed tab when we do that!
      chrome.windows.get( tabWindow.openWindowId, { populate: true }, function ( chromeWindow ) {
        console.log("closeTab: got window state: ", chromeWindow);
        winStore.syncChromeWindow(chromeWindow);
      });
      */
      winStore.handleTabClosed(tabWindow,tabId);
    }
  });
}

export function closeWindow(winStore,tabWindow) {
  console.log("closeWindow: ", tabWindow);
  if (!tabWindow.open) {
    console.log("closeWindow: request to close non-open window, ignoring...");
    return;
  }
  var self = this;
  chrome.windows.remove( tabWindow.openWindowId, function() {
    winStore.handleTabWindowClosed(tabWindow);
  });
}

/*
 * save the specified tab window and make it a managed window
 */
export function manageWindow(winStore,tabWindow,title,cb) {
  const tabmanFolderId = winStore.folderId;

  // and write out a Bookmarks folder for this newly managed window:
  if( !tabmanFolderId ) {
    alert( "Could not save bookmarks -- no tab manager folder" );
  }
  var windowFolder = { parentId: tabmanFolderId,
                       title: title,
                     };
  chrome.bookmarks.create( windowFolder, function( windowFolderNode ) {
    console.log( "succesfully created bookmarks folder ", windowFolderNode );
    console.log( "for window: ", tabWindow );
    var tabItems = tabWindow.tabItems.toArray();

    var bookmarkActions = tabItems.map((tabItem) => {
      function makeBookmarkAction(v,cb) {
        const tabMark = { parentId: windowFolderNode.id, title: tabItem.title, url: tabItem.url };
        chrome.bookmarks.create( tabMark, function( tabNode ) {
          cb(tabNode);
        });
      }
      return makeBookmarkAction;
    });

    utils.seqActions(bookmarkActions,null,(bmNode) => {
      // Now do an explicit get of subtree to get node populated with children
      chrome.bookmarks.getSubTree( windowFolderNode.id, function ( folderNodes ) {
        var fullFolderNode = folderNodes[ 0 ];

        // We'll retrieve the latest chrome Window state and attach that:
        chrome.windows.get(tabWindow.openWindowId,{populate: true}, (chromeWindow) => {
          const savedTabWindow = winStore.attachBookmarkFolder(fullFolderNode,chromeWindow);
          cb(savedTabWindow);
        });
      } );
    });
  });    
}

/* stop managing the specified window...move all bookmarks for this managed window to Recycle Bin */
export function unmanageWindow(winStore,tabWindow) {
  console.log("unmanageWindow: ", tabWindow.toJS());
  if( !winStore.archiveFolderId ) {
    alert( "could not move managed window folder to archive -- no archive folder" );
    return;
  }
  // Could potentially disambiguate names in archive folder...
  chrome.bookmarks.move( tabWindow.savedFolderId, { parentId: winStore.archiveFolderId }, (resultNode) => {
    console.log("unmanageWindow: bookmark folder moved to archive folder");
    winStore.unmanageWindow(tabWindow);
  });
}

export function revertWindow(winStore,tabWindow) {
  const currentTabIds = tabWindow.tabItems.filter((ti) => ti.open).map((ti) => ti.openTabId).toArray();

  const revertedTabWindow = TabWindow.removeOpenWindowState(tabWindow);

  // re-open saved URLs:
  // We need to do this before removing current tab ids or window will close
  var savedUrls = revertedTabWindow.tabItems.map((ti) => ti.url).toArray();

  for ( var i = 0; i < savedUrls.length; i++ ) {
    // need to open it:
    var tabInfo = { windowId: tabWindow.openWindowId, url: savedUrls[ i ] };
    chrome.tabs.create( tabInfo );
  };        

  // blow away all the existing tabs:
  chrome.tabs.remove( currentTabIds, function() {
    var windowId = tabWindow.openWindowId;
    // refresh window details:
    chrome.windows.get( windowId, { populate: true }, function ( chromeWindow ) {
      winStore.syncChromeWindow(chromeWindow);
    });
  });
}