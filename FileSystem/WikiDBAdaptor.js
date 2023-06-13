/*\
title: $:/plugins/OokTech/Bob/WikiDBAdaptor.js
type: application/javascript
module-type: ablorksyncadaptor

A sync adaptor module for synchronising multiple wikis

\*/
(function(){

  /*jslint node: true, browser: true */
  /*global $tw: false */
  "use strict";
  
  exports.platforms = ["node"];

  if($tw.node && false) {
  
    // Get a reference to the file system
    //const fs = require("fs"),
    //  path = require("path");
  
    $tw.Bob = $tw.Bob || {};
    $tw.Bob.Files = $tw.Bob.Files || {};
  
    /*
      TODO Create a message that lets us set excluded tiddlers from inside the wikis
      A per-wiki exclude list would be best but that is going to have annoying
      logic so it will come later.
    */
    $tw.Bob.ExcludeFilter = $tw.Bob.ExcludeFilter || "[[$:/StoryList]][[$:/HistoryList]][[$:/status/UserName]][[$:/Import]][prefix[$:/state/]][prefix[$:/temp/]][prefix[$:/WikiSettings]]";
  
    function WikiDBAdaptor(options) {
      this.wiki = options.wiki;
    }
  
    $tw.hooks.addHook("th-make-tiddler-path", function(thePath, originalPath) {
      return originalPath;
    })
  
    WikiDBAdaptor.prototype.name = "WikiDBAdaptor";
  
    WikiDBAdaptor.prototype.isReady = function() {
      // The file system adaptor is always ready
      return true;
    };
  
    WikiDBAdaptor.prototype.getTiddlerInfo = function(tiddler) {
      return {};
    };
  
    /*
    Return a fileInfo object for a tiddler, creating it if necessary:
      filepath: the absolute path to the file containing the tiddler
      type: the type of the tiddler file (NOT the type of the tiddler -- see below)
      hasMetaFile: true if the file also has a companion .meta file
  
    The boot process populates $tw.boot.files for each of the tiddler files that it loads. The type is found by looking up the extension in $tw.config.fileExtensionInfo (eg "application/x-tiddler" for ".tid" files).
  
    It is the responsibility of the filesystem adaptor to update $tw.boot.files for new files that are created.
    */
    WikiDBAdaptor.prototype.getTiddlerFileInfo = function(tiddler, prefix, callback) {
      prefix = prefix || '';
      if(!callback) {
        callback = function (err, fileInfo) {
          if(err) {
            $tw.Bob.logger.error(err, {level:2});
          } else {
            return fileInfo;
          }
        }
      }
      // Generate the base filepath and ensure the directories exist
      $tw.Bob.Wikis = $tw.Bob.Wikis || {};
      $tw.Bob.Wikis[prefix] = $tw.Bob.Wikis[prefix] || {};
      // A cludge to make things work
      if(prefix === 'RootWiki') {
        $tw.Bob.Wikis[prefix].wikiTiddlersPath = $tw.Bob.Wikis[prefix].wikiTiddlersPath || $tw.boot.wikiTiddlersPath;
      }
      //const tiddlersPath = $tw.Bob.Wikis[prefix].wikiTiddlersPath || path.join($tw.ServerSide.generateWikiPath(prefix), 'tiddlers');
      //$tw.utils.createFileDirectories(tiddlersPath);
  
      // See if we've already got information about this file
      const title = tiddler.fields.title;
      $tw.Bob.Files[prefix] = $tw.Bob.Files[prefix] || {};
      let fileInfo = $tw.Bob.Files[prefix][title];
      if(!fileInfo) {
        // Otherwise, we'll need to generate it
        fileInfo = $tw.utils.generateTiddlerFileInfo(tiddler,{
          directory: tiddlersPath,
          pathFilters: [],
          wiki: $tw.Bob.Wikis[prefix].wiki
        });
  
        $tw.Bob.Files[prefix][title] = fileInfo;
        $tw.Bob.Wikis[prefix].tiddlers = $tw.Bob.Wikis[prefix].tiddlers || [];
        if($tw.Bob.Wikis[prefix].tiddlers.indexOf(title) === -1) {
          $tw.Bob.Wikis[prefix].tiddlers.push(title);
        }
      }
      callback(null,fileInfo);
    };
  
    /*
    Given a list of filters, apply every one in turn to source, and return the first result of the first filter with non-empty result.
    */
    WikiDBAdaptor.prototype.findFirstFilter = function(filters,source) {
      for(let i=0; i<filters.length; i++) {
        const result = this.wiki.filterTiddlers(filters[i],null,source);
        if(result.length > 0) {
          return result[0];
        }
      }
      return null;
    };
  
    /*
    Given a tiddler title and an array of existing filenames, generate a new legal filename for the title, case insensitively avoiding the array of existing filenames
    */
    WikiDBAdaptor.prototype.generateTiddlerBaseFilepath = function(title, wiki) {
      let baseFilename;
      if(!baseFilename) {
        // No mappings provided, or failed to match this tiddler so we use title as filename
        baseFilename = title.replace(/\/|\\/g,"_");
      }
      // Remove any of the characters that are illegal in Windows filenames
      baseFilename = $tw.utils.transliterate(baseFilename.replace(/<|>|\:|\"|\||\?|\*|\^/g,"_"));
      // Truncate the filename if it is too long
      if(baseFilename.length > 200) {
        baseFilename = baseFilename.substr(0,200);
      }
      return baseFilename;
    };
  
    /*
    Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
    */
    WikiDBAdaptor.prototype.saveTiddler = function(tiddler, prefix, connectionInd, callback) {
      const self = this;
      if(typeof prefix === 'function') {
        callback = prefix;
        prefix = null;
        connectionInd = null;
      }
      if(typeof connectionInd === 'function') {
        connectionInd = null;
        callback = connectionInd
      }
      if(typeof callback !== 'function') {
        callback = function () {
  
        }
      }
      prefix = prefix || 'RootWiki';
      if(!$tw.Bob.Wikis[prefix]) {
        $tw.syncadaptor.loadWiki(prefix, finish);
      } else {
        finish();
      }
      function finish() {
        const store_uri = 'localhost:9999/store'
        if(tiddler && $tw.Bob.Wikis[prefix].wiki.filterTiddlers($tw.Bob.ExcludeFilter).indexOf(tiddler.fields.title) === -1) {
          self.getTiddlerFileInfo(new $tw.Tiddler(tiddler.fields), prefix,
           function(err,fileInfo) {
            if(err) {
              return callback(err);
            }
            // Make sure that the tiddler has actually changed before saving it
            if($tw.Bob.Shared.TiddlerHasChanged(tiddler, $tw.Bob.Wikis[prefix].wiki.getTiddler(tiddler.fields.title))) {
              // Save the tiddler in memory.
              internalSave(tiddler, prefix, connectionInd);
              $tw.Bob.Wikis[prefix].modified = true;
              $tw.Bob.logger.log('Save Tiddler ', tiddler.fields.title, {level:2});
              try {
                $tw.utils.httpRequest({
                  url: store_uri,
                  type: 'post',
                  headers: headers,
                  data: {
                    db: prefix,
                    docs: [tiddler],
                    overwrite: true
                  },
                  callback: function(err,getResponseDataJson,xhr) {
                    var getResponseData;
                    if(err && xhr.status !== 404) {
                      return callback(err);
                    }
                    if(xhr.status !== 404) {
                      $tw.Bob.logger.log('saved tiddler ', fileInfo.filepath, {level:2});
                      
                      $tw.hooks.invokeHook('wiki-modified', prefix);
      
                      getResponseData = $tw.utils.parseJSONSafe(getResponseDataJson);
                      console.log(getResponseData)
                    }
                    return callback(null)
                  }
                })
              } catch (e) {
                  $tw.Bob.logger.log('Error Saving Tiddler ', tiddler.fields.title, e, {level:1});
              }
            }
          });
        }
      }
    };
  
    // Before the tiddler file is saved this takes care of the internal part
    function internalSave (tiddler, prefix, sourceConnection) {
      $tw.Bob.Wikis[prefix].wiki.addTiddler(new $tw.Tiddler(tiddler.fields));
      const message = {
        type: 'saveTiddler',
        wiki: prefix,
        tiddler: {
          fields: tiddler.fields
        }
      };
      $tw.Bob.SendToBrowsers(message, sourceConnection);
      // This may help
      $tw.Bob.Wikis = $tw.Bob.Wikis || {};
      $tw.Bob.Wikis[prefix] = $tw.Bob.Wikis[prefix] || {};
      $tw.Bob.Wikis[prefix].tiddlers = $tw.Bob.Wikis[prefix].tiddlers || [];
      if($tw.Bob.Wikis[prefix].tiddlers.indexOf(tiddler.fields.title) === -1) {
        $tw.Bob.Wikis[prefix].tiddlers.push(tiddler.fields.title);
      }
    }
  
    /*
    Load a tiddler and invoke the callback with (err,tiddlerFields)
  
    We don't need to implement loading for the file system adaptor, because all the tiddler files will have been loaded during the boot process.
    */
    WikiDBAdaptor.prototype.loadTiddler = function(title,callback) {
      if(!callback) {
        callback = function () {
  
        }
      }
      callback(null,null);
    };
  
    /*
    Delete a tiddler and invoke the callback with (err)
    */
    WikiDBAdaptor.prototype.deleteTiddler = function(title, callback, options) {
      const delete_uri = 'localhost:9999/deletedoc'
      const headers = {}
      if(typeof callback === 'object') {
        options = callback;
        callback = null;
      }
      if(!callback || typeof callback === 'object') {
        callback = function () {
          // Just a blank function to prevent errors
        }
      }
      if(typeof options !== 'object') {
        if(typeof options === 'string') {
          options = {wiki: options}
        } else {
          callback("no wiki given");
          return
        }
      }
      const prefix = options.wiki;
      if(!$tw.Bob.Files[prefix]) {
        $tw.ServerSide.loadWiki(prefix, finish);
      } else {
        finish();
      }
      function finish() {
        const fileInfo = $tw.Bob.Files[prefix][title];
        // I guess unconditionally say the wiki is modified in this case.
        $tw.Bob.Wikis[prefix].modified = true;
        // Only delete the tiddler if we have writable information for the file
        if(fileInfo) {
          // Delete the file
          // send the POST request to delete the tiddler
          $tw.utils.httpRequest({
            url: delete_uri,
            type: 'post',
            headers: headers,
            data: {
              db: prefix,
              filter: [title]
            },
            callback: function(err,getResponseDataJson,xhr) {
              var getResponseData;
              if(err && xhr.status !== 404) {
                return callback(err);
              }
              if(xhr.status !== 404) {
                $tw.Bob.logger.log('deleted tiddler ', fileInfo.filepath, {level:2});
                // Delete the tiddler from the internal tiddlywiki side of things
                delete $tw.Bob.Files[prefix][title];
                $tw.Bob.Wikis[prefix].wiki.deleteTiddler(title);
                // Create a message saying to remove the tiddler
                const message = {type: 'deleteTiddler', tiddler: {fields:{title: title}}, wiki: prefix};
                // Send the message to each connected browser
                $tw.Bob.SendToBrowsers(message);
                $tw.hooks.invokeHook('wiki-modified', prefix);

                getResponseData = $tw.utils.parseJSONSafe(getResponseDataJson);
                console.log(getResponseData)
              }
              return callback(null)
            }
          })
        } else {
          callback(null);
        }
      }
    };
  
    if($tw.node) {
      exports.adaptorClass = WikiDBAdaptor;
    }
  }
  
  })();
  